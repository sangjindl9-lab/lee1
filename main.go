// 검측서류 작성·관리 — Windows 실행 파일
// 내장된 HTML 화면을 이 PC 안에서만 열리는 로컬 서버(127.0.0.1)로 띄우고,
// Edge/Chrome 앱 창으로 엽니다. 데이터는 EXE 옆 "검측서류_데이터\data.json" 파일에 저장합니다.
package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed index.html
var indexHTML []byte

const (
	appID        = "gcms"
	appTitle     = "검측서류 작성·관리"
	firstPort    = 37615
	lastPort     = 37634
	keepBackups  = 60
	maxBodyBytes = 200 << 20
)

var (
	dataDir   string
	dataFile  string
	mu        sync.Mutex
	rev       int64
	lastPing  = time.Now()
	pingMu    sync.Mutex
	listenURL string
)

func main() {
	if os.Getenv("GCMS_WEB") == "1" {
		webMain()
		return
	}
	setupDataDir()
	lf, err := os.OpenFile(filepath.Join(dataDir, "log.txt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		log.SetOutput(lf)
		defer lf.Close()
	}
	log.Printf("시작: dataDir=%s", dataDir)

	// 이미 실행 중이면 그 창만 새로 열고 종료
	for p := firstPort; p <= lastPort; p++ {
		if isOurServer(p) {
			u := fmt.Sprintf("http://127.0.0.1:%d/", p)
			log.Printf("이미 실행 중: %s", u)
			openWindow(u, false)
			return
		}
	}

	ln, port, err := listenFree()
	if err != nil {
		fatal("사용할 수 있는 포트를 찾지 못했습니다.\n" + err.Error())
	}
	listenURL = fmt.Sprintf("http://127.0.0.1:%d/", port)
	if fi, err := os.Stat(dataFile); err == nil {
		rev = fi.ModTime().UnixNano()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.HandleFunc("/api/ping", handlePing)
	mux.HandleFunc("/api/data", handleData)
	mux.HandleFunc("/api/rev", handleRev)
	mux.HandleFunc("/api/open-folder", handleOpenFolder)
	mux.HandleFunc("/api/photos", handlePhotoList)
	mux.HandleFunc("/api/photos/", handlePhoto)
	srv := &http.Server{Handler: hostGuard(port, mux), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("서버 오류: %v", err)
		}
	}()
	log.Printf("서버: %s", listenURL)

	if os.Getenv("GCMS_NO_BROWSER") == "1" { // 테스트용
		select {}
	}
	browserDone := openWindow(listenURL, true)
	waitForExit(browserDone)
	log.Printf("종료")
}

/* ---------------- 데이터 폴더 ---------------- */
func setupDataDir() {
	exe, _ := os.Executable()
	cands := []string{}
	if exe != "" {
		cands = append(cands, filepath.Join(filepath.Dir(exe), "검측서류_데이터"))
	}
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		cands = append(cands, filepath.Join(la, "검측서류관리"))
	}
	if h, err := os.UserHomeDir(); err == nil {
		cands = append(cands, filepath.Join(h, "검측서류_데이터"))
	}
	for _, d := range cands {
		if err := os.MkdirAll(d, 0o755); err != nil {
			continue
		}
		t := filepath.Join(d, ".write-test")
		if err := os.WriteFile(t, []byte("ok"), 0o644); err != nil {
			continue
		}
		os.Remove(t)
		dataDir = d
		dataFile = filepath.Join(d, "data.json")
		_ = os.MkdirAll(filepath.Join(d, "backups"), 0o755)
		_ = os.MkdirAll(filepath.Join(d, "photos", "삭제됨"), 0o755)
		go cleanTrash()
		return
	}
	fatal("데이터를 저장할 폴더를 만들 수 없습니다.\nEXE를 바탕화면이나 문서 폴더처럼 쓰기 가능한 위치로 옮겨 실행하세요.")
}

/* ---------------- HTTP ---------------- */
func hostGuard(port int, h http.Handler) http.Handler {
	ok := map[string]bool{fmt.Sprintf("127.0.0.1:%d", port): true, fmt.Sprintf("localhost:%d", port): true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ok[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(indexHTML)
}

func handlePing(w http.ResponseWriter, r *http.Request) {
	pingMu.Lock()
	lastPing = time.Now()
	pingMu.Unlock()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if webMode {
		json.NewEncoder(w).Encode(map[string]any{"app": appID, "web": true})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"app": appID, "dataDir": dataDir, "dataFile": dataFile})
}

func handleRev(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	v := rev
	mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(strconv.FormatInt(v, 10)))
}

func handleData(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("X-Rev", strconv.FormatInt(rev, 10))
		b, err := os.ReadFile(dataFile)
		if errors.Is(err, os.ErrNotExist) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			http.Error(w, "data.json 읽기 실패: "+err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(b)
	case http.MethodPut:
		if r.Header.Get("X-GCMS") != "1" {
			http.Error(w, "forbidden", 403)
			return
		}
		if base := r.Header.Get("X-Base-Rev"); base != strconv.FormatInt(rev, 10) {
			w.Header().Set("X-Rev", strconv.FormatInt(rev, 10))
			http.Error(w, "conflict", http.StatusConflict)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
		if err != nil || len(b) > maxBodyBytes {
			http.Error(w, "요청 데이터를 읽지 못했습니다", 400)
			return
		}
		if !json.Valid(b) {
			http.Error(w, "올바른 JSON이 아닙니다", 400)
			return
		}
		dailyBackup()
		if err := atomicWrite(dataFile, b); err != nil {
			log.Printf("저장 실패: %v", err)
			http.Error(w, "파일 저장 실패: "+err.Error(), 500)
			return
		}
		rev = time.Now().UnixNano()
		w.Header().Set("X-Rev", strconv.FormatInt(rev, 10))
		w.Write([]byte("ok"))
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("X-GCMS") != "1" {
		http.Error(w, "forbidden", 403)
		return
	}
	if runtime.GOOS == "windows" && !webMode {
		exec.Command("explorer.exe", dataDir).Start()
	}
	w.Write([]byte("ok"))
}

func atomicWrite(path string, b []byte) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// 하루 중 처음 저장할 때 직전 data.json을 backups\data_YYYY-MM-DD.json 으로 보관
func dailyBackup() {
	src, err := os.ReadFile(dataFile)
	if err != nil {
		return
	}
	dir := filepath.Join(dataDir, "backups")
	dst := filepath.Join(dir, "data_"+time.Now().Format("2006-01-02")+".json")
	if _, err := os.Stat(dst); err == nil {
		return
	}
	if err := os.WriteFile(dst, src, 0o644); err != nil {
		log.Printf("자동 백업 실패: %v", err)
		return
	}
	ents, _ := filepath.Glob(filepath.Join(dir, "data_*.json"))
	sort.Strings(ents)
	for len(ents) > keepBackups {
		os.Remove(ents[0])
		ents = ents[1:]
	}
}

/* ---------------- 포트 / 중복 실행 ---------------- */
func listenFree() (net.Listener, int, error) {
	var last error
	for p := firstPort; p <= lastPort; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, p, nil
		}
		last = err
	}
	return nil, 0, last
}

func isOurServer(port int) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/ping", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var o map[string]string
	if json.NewDecoder(resp.Body).Decode(&o) != nil {
		return false
	}
	return o["app"] == appID
}

/* ---------------- 창 열기 / 종료 감시 ---------------- */
// Edge(또는 Chrome)를 앱 창 모드로 엽니다. 전용 프로필을 쓰므로 창이 닫히면 프로세스가 끝납니다.
// 반환 채널은 브라우저 프로세스가 끝났을 때 닫힙니다(앱 창을 못 쓰면 nil).
func openWindow(u string, primary bool) chan struct{} {
	if runtime.GOOS != "windows" {
		return nil
	}
	if b := findBrowser(); b != "" {
		args := []string{
			"--app=" + u,
			"--user-data-dir=" + filepath.Join(dataDir, "app-window"),
			"--no-first-run", "--no-default-browser-check", "--disable-sync",
			"--window-size=1500,950",
		}
		cmd := exec.Command(b, args...)
		if err := cmd.Start(); err == nil {
			log.Printf("앱 창: %s", b)
			done := make(chan struct{})
			go func() { cmd.Wait(); close(done) }()
			return done
		} else {
			log.Printf("앱 창 실행 실패: %v", err)
		}
	}
	// 기본 브라우저로 열기
	exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	return nil
}

func findBrowser() string {
	var c []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if base := os.Getenv(env); base != "" {
			c = append(c,
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`))
		}
	}
	for _, p := range c {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p
		}
	}
	return ""
}

func sincePing() time.Duration {
	pingMu.Lock()
	defer pingMu.Unlock()
	return time.Since(lastPing)
}

// 종료 조건
//   - 앱 창 프로세스가 끝났고 화면 신호도 60초간 없을 때
//   - 앱 창을 쓰지 못한 경우(기본 브라우저): 화면 신호가 15분간 없을 때
//     (인쇄 대화상자가 열려 있는 동안에는 화면 신호가 멈출 수 있어 여유를 둡니다)
func waitForExit(browserDone chan struct{}) {
	exited := false
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		if browserDone != nil && !exited {
			select {
			case <-browserDone:
				exited = true
				log.Printf("앱 창 프로세스 종료")
			default:
			}
		}
		idle := sincePing()
		if browserDone != nil && exited && idle > 60*time.Second {
			return
		}
		if (browserDone == nil || exited) && idle > 15*time.Minute && time.Since(start) > 15*time.Minute {
			return
		}
	}
}

func fatal(msg string) {
	log.Printf("치명적 오류: %s", msg)
	messageBox(appTitle, msg)
	os.Exit(1)
}

func init() {
	// 로그 시간 형식
	log.SetFlags(log.Ldate | log.Ltime)
	_ = strings.TrimSpace
}

/* ---------------- 사진 ---------------- */
var photoID = regexp.MustCompile(`^[a-z0-9]{6,40}$`)

const maxPhotoBytes = 25 << 20

func photoPath(id string) string { return filepath.Join(dataDir, "photos", id+".jpg") }

func handlePhotoList(w http.ResponseWriter, r *http.Request) {
	ents, _ := os.ReadDir(filepath.Join(dataDir, "photos"))
	out := []map[string]any{}
	for _, e := range ents {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".jpg") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, map[string]any{"id": strings.TrimSuffix(n, ".jpg"), "created": fi.ModTime().UnixMilli()})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

func handlePhoto(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/photos/")
	if !photoID.MatchString(id) {
		http.Error(w, "잘못된 사진 번호", 400)
		return
	}
	fp := photoPath(id)
	switch r.Method {
	case http.MethodGet:
		f, err := os.Open(fp)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		head := make([]byte, 512)
		n, _ := f.Read(head)
		f.Seek(0, 0)
		w.Header().Set("Content-Type", http.DetectContentType(head[:n]))
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		io.Copy(w, f)
	case http.MethodPut:
		if r.Header.Get("X-GCMS") != "1" {
			http.Error(w, "forbidden", 403)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, maxPhotoBytes+1))
		if err != nil || len(b) > maxPhotoBytes {
			http.Error(w, "사진이 너무 큽니다", 400)
			return
		}
		ct := http.DetectContentType(b)
		if ct != "image/jpeg" && ct != "image/png" && ct != "image/webp" {
			http.Error(w, "이미지 파일이 아닙니다 ("+ct+")", 400)
			return
		}
		if err := atomicWrite(fp, b); err != nil {
			log.Printf("사진 저장 실패: %v", err)
			http.Error(w, "사진 저장 실패: "+err.Error(), 500)
			return
		}
		w.Write([]byte("ok"))
	case http.MethodDelete:
		if r.Header.Get("X-GCMS") != "1" {
			http.Error(w, "forbidden", 403)
			return
		}
		// 바로 지우지 않고 "삭제됨" 폴더로 옮김(30일 뒤 자동 삭제)
		dst := filepath.Join(dataDir, "photos", "삭제됨", id+".jpg")
		if err := os.Rename(fp, dst); err == nil {
			now := time.Now()
			os.Chtimes(dst, now, now)
		}
		w.Write([]byte("ok"))
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func cleanTrash() {
	dir := filepath.Join(dataDir, "photos", "삭제됨")
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if fi, err := e.Info(); err == nil && time.Since(fi.ModTime()) > 30*24*time.Hour {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}
