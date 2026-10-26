package main

// 웹 모드 (Railway 등 서버 배포용)
//   GCMS_WEB=1           웹 모드로 실행
//   PORT                 접속 포트 (Railway가 자동 지정)
//   GCMS_DATA_DIR        데이터 저장 폴더 (Railway 볼륨 경로, 기본 /data)
//   GCMS_PASSWORD        로그인 비밀번호 (필수, 8자 이상)

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var webMode bool

const (
	cookieName = "gcms_s"
	sessionTTL = 30 * 24 * time.Hour
)

var (
	sessMu   sync.Mutex
	sessions = map[string]int64{} // sha256(token) -> 만료(unix)
	failMu   sync.Mutex
	fails    = map[string]*failRec{}
	password string
)

type failRec struct {
	n     int
	until time.Time
}

func webMain() {
	webMode = true
	log.SetOutput(os.Stdout)
	dataDir = os.Getenv("GCMS_DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("데이터 폴더를 만들 수 없음: %v", err)
	}
	dataFile = filepath.Join(dataDir, "data.json")
	os.MkdirAll(filepath.Join(dataDir, "backups"), 0o755)
	os.MkdirAll(filepath.Join(dataDir, "photos", "삭제됨"), 0o755)
	go cleanTrash()
	if fi, err := os.Stat(dataFile); err == nil {
		rev = fi.ModTime().UnixNano()
	}
	password = os.Getenv("GCMS_PASSWORD")
	if len([]rune(password)) < 8 {
		log.Printf("경고: GCMS_PASSWORD가 없거나 8자 미만입니다. 설정하기 전까지 접속을 막습니다.")
		password = ""
	}
	loadSessions()

	api := http.NewServeMux()
	api.HandleFunc("/api/ping", handlePing)
	api.HandleFunc("/api/data", handleData)
	api.HandleFunc("/api/rev", handleRev)
	api.HandleFunc("/api/photos", handlePhotoList)
	api.HandleFunc("/api/photos/", handlePhoto)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("/login", handleLogin)
	mux.HandleFunc("/logout", handleLogout)
	mux.Handle("/api/", requireAuth(api, true))
	mux.Handle("/", requireAuth(http.HandlerFunc(handleIndex), false))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	srv := &http.Server{Addr: ":" + port, Handler: secHeaders(mux), ReadHeaderTimeout: 15 * time.Second}
	log.Printf("웹 모드 시작 :%s  데이터=%s", port, dataDir)
	log.Fatal(srv.ListenAndServe())
}

func secHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		if isHTTPS(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=15552000")
		}
		h.ServeHTTP(w, r)
	})
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	if i := strings.LastIndex(r.RemoteAddr, ":"); i > 0 {
		return r.RemoteAddr[:i]
	}
	return r.RemoteAddr
}

/* ---------------- 세션 ---------------- */
func hashTok(t string) string { s := sha256.Sum256([]byte(t)); return hex.EncodeToString(s[:]) }

func sessFile() string { return filepath.Join(dataDir, "sessions.json") }

func loadSessions() {
	b, err := os.ReadFile(sessFile())
	if err != nil {
		return
	}
	json.Unmarshal(b, &sessions)
}

func saveSessionsLocked() {
	now := time.Now().Unix()
	for k, v := range sessions {
		if v < now {
			delete(sessions, k)
		}
	}
	b, _ := json.Marshal(sessions)
	atomicWrite(sessFile(), b)
}

func validSession(r *http.Request) bool {
	if password == "" {
		return false
	}
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) < 32 {
		return false
	}
	sessMu.Lock()
	defer sessMu.Unlock()
	exp, ok := sessions[hashTok(c.Value)]
	return ok && exp > time.Now().Unix()
}

func requireAuth(h http.Handler, isAPI bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if validSession(r) {
			h.ServeHTTP(w, r)
			return
		}
		if isAPI {
			http.Error(w, "로그인이 필요합니다", http.StatusUnauthorized)
			return
		}
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	})
}

/* ---------------- 로그인 ---------------- */
func handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if r.Method == http.MethodPost {
		if password == "" {
			loginPage(w, "서버에 비밀번호(GCMS_PASSWORD)가 설정되지 않아 로그인할 수 없습니다. 관리자에게 문의하세요.")
			return
		}
		failMu.Lock()
		fr := fails[ip]
		if fr != nil && time.Now().Before(fr.until) {
			failMu.Unlock()
			loginPage(w, "비밀번호를 여러 번 틀려 15분 동안 로그인이 잠겼습니다.")
			return
		}
		failMu.Unlock()
		pw := r.PostFormValue("password")
		if subtle.ConstantTimeCompare([]byte(hashTok(pw)), []byte(hashTok(password))) != 1 {
			time.Sleep(600 * time.Millisecond)
			failMu.Lock()
			if fr == nil {
				fr = &failRec{}
				fails[ip] = fr
			}
			fr.n++
			if fr.n >= 10 {
				fr.n = 0
				fr.until = time.Now().Add(15 * time.Minute)
			}
			failMu.Unlock()
			log.Printf("로그인 실패: %s", ip)
			loginPage(w, "비밀번호가 맞지 않습니다.")
			return
		}
		failMu.Lock()
		delete(fails, ip)
		failMu.Unlock()
		buf := make([]byte, 32)
		rand.Read(buf)
		tok := hex.EncodeToString(buf)
		sessMu.Lock()
		sessions[hashTok(tok)] = time.Now().Add(sessionTTL).Unix()
		saveSessionsLocked()
		sessMu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: tok, Path: "/", HttpOnly: true, Secure: isHTTPS(r),
			SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
		log.Printf("로그인: %s", ip)
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	if validSession(r) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	msg := ""
	if r.URL.Query().Get("expired") != "" {
		msg = "로그인이 만료되었습니다. 다시 로그인하세요."
	}
	if password == "" {
		msg = "서버에 비밀번호(GCMS_PASSWORD)가 설정되지 않았습니다."
	}
	loginPage(w, msg)
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	if c, err := r.Cookie(cookieName); err == nil {
		sessMu.Lock()
		delete(sessions, hashTok(c.Value))
		saveSessionsLocked()
		sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r)})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func loginPage(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	em := ""
	if msg != "" {
		em = `<p class="err">` + html.EscapeString(msg) + `</p>`
	}
	fmt.Fprintf(w, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>로그인 · 검측서류 작성·관리</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef0f3;font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#14181f}
.box{background:#fff;border:1px solid #cfd4dc;border-radius:10px;padding:28px 28px 22px;width:min(360px,calc(100vw - 32px));box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:19px;margin:0 0 4px}p.s{color:#646b76;font-size:13px;margin:0 0 18px}
label{display:block;font-size:13px;font-weight:700;margin-bottom:6px}
input{width:100%%;box-sizing:border-box;border:1px solid #cfd4dc;border-radius:6px;padding:10px;font-size:15px}
button{width:100%%;margin-top:14px;background:#1f4fbf;color:#fff;border:0;border-radius:6px;padding:11px;font-size:15px;cursor:pointer}
.err{background:#fde8e8;color:#8a1c12;border-radius:6px;padding:8px 10px;font-size:13px}
</style></head><body><form class="box" method="post" action="/login">
<h1>검측서류 작성·관리</h1><p class="s">회사 공용 비밀번호로 로그인하세요.</p>%s
<label for="pw">비밀번호</label><input id="pw" type="password" name="password" autocomplete="current-password" autofocus required>
<button type="submit">로그인</button></form></body></html>`, em)
}
