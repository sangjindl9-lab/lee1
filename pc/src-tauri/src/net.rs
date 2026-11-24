// 대용량 스트리밍 전송(클라우드 중계·NAS)과 WebDAV(NAS) 처리
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

const KEYRING_SERVICE: &str = "FileManager2PC-NAS";

fn canceled() -> &'static Mutex<HashSet<String>> {
    static C: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashSet::new()))
}
fn is_canceled(id: &str) -> bool { canceled().lock().map(|s| s.contains(id)).unwrap_or(false) }

#[derive(Deserialize, Clone, Default)]
pub struct NasAuth {
    pub id: String,
    pub user: String,
    #[serde(default)]
    pub insecure: bool,
    /// 등록한 NAS 주소. 비밀번호는 이 주소(같은 scheme·호스트·포트, 이 경로 아래)로만 보냅니다.
    #[serde(default)]
    pub root: String,
}

fn client(insecure: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(insecure)
        .user_agent("FileManager2PC")
        .build()
        .map_err(|e| e.to_string())
}
/// NAS용: 리다이렉트를 따라가지 않습니다(비밀번호가 다른 곳으로 가지 않도록).
fn nas_client(insecure: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(insecure)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("FileManager2PC")
        .build()
        .map_err(|e| e.to_string())
}
fn client_for(nas: &Option<NasAuth>) -> Result<reqwest::Client, String> {
    match nas { Some(n) => nas_client(n.insecure), None => client(false) }
}

pub fn is_private_host(host: &str) -> bool {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".home.arpa") { return true; }
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local(),
            std::net::IpAddr::V6(v) => v.is_loopback() || (v.segments()[0] & 0xffc0) == 0xfe80 || (v.segments()[0] & 0xfe00) == 0xfc00,
        };
    }
    false
}
/// http(암호화 없음)·'인증서 확인 안 함'은 내부망 주소에서만 허용
pub fn transport_problem(root: &reqwest::Url, insecure: bool) -> Option<String> {
    if !root.username().is_empty() || root.password().is_some() { return Some("주소에 아이디를 넣지 마세요".into()); }
    let host = root.host_str().unwrap_or("");
    if is_private_host(host) { return None; }
    if root.scheme() == "http" { return Some("외부(인터넷) 주소는 HTTPS만 쓸 수 있습니다. http는 비밀번호가 그대로 노출됩니다".into()); }
    if insecure { return Some("'인증서 확인 안 함'은 내부망 주소(192.168.x.x 등)에서만 쓸 수 있습니다".into()); }
    None
}
fn norm_root(u: &str) -> Result<reqwest::Url, String> {
    let mut r = reqwest::Url::parse(u).map_err(|_| "NAS 주소 형식이 올바르지 않습니다".to_string())?;
    if !r.path().ends_with('/') { let p = format!("{}/", r.path()); r.set_path(&p); }
    Ok(r)
}
fn same_origin(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    a.scheme() == b.scheme() && a.host_str().map(|h| h.to_ascii_lowercase()) == b.host_str().map(|h| h.to_ascii_lowercase()) && a.port_or_known_default() == b.port_or_known_default()
}
/// url이 등록한 NAS 범위 안인지 (같은 origin, 등록 경로 아래, 아이디 포함 금지, 인코딩된 우회 금지)
pub fn in_scope(root: &reqwest::Url, url: &str) -> bool {
    let u = match reqwest::Url::parse(url) { Ok(u) => u, Err(_) => return false };
    let lp = u.path().to_ascii_lowercase();
    if !u.username().is_empty() || u.password().is_some() || lp.contains("%2e%2e") || lp.contains("%2f") || lp.contains("%5c") { return false; }
    if !same_origin(root, &u) { return false; }
    let rp = root.path();
    u.path() == rp.trim_end_matches('/') || u.path().starts_with(rp)
}

/// 비밀번호를 쓰기 전 검사: 저장할 때 묶어 둔 주소 범위 안의 요청에만 Authorization을 붙입니다.
fn apply(mut rb: reqwest::RequestBuilder, url: &str, headers: &[(String, String)], nas: &Option<NasAuth>) -> Result<reqwest::RequestBuilder, String> {
    for (k, v) in headers { rb = rb.header(k, v); }
    if let Some(n) = nas {
        let (bound, pw) = nas_secret(n)?;
        let root = norm_root(&bound)?;
        if let Some(p) = transport_problem(&root, n.insecure) { return Err(p); }
        if !n.root.is_empty() {
            let cur = norm_root(&n.root)?;
            if !same_origin(&root, &cur) || !cur.path().starts_with(root.path()) {
                return Err("NAS 주소가 바뀌어 저장된 비밀번호를 쓰지 않습니다. 비밀번호를 다시 입력해 주세요".into());
            }
        }
        if !in_scope(&root, url) { return Err("등록한 NAS 주소 밖으로는 요청하지 않습니다".into()); }
        rb = rb.header("Authorization", format!("Basic {}", STANDARD.encode(format!("{}:{}", n.user, pw))));
    }
    Ok(rb)
}

async fn err_text(r: reqwest::Response) -> String {
    let st = r.status();
    let t = r.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<serde_json::Value>(&t).ok().and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from));
    match st.as_u16() {
        401 => msg.unwrap_or_else(|| "인증에 실패했습니다 (아이디·비밀번호 확인)".into()),
        403 => msg.unwrap_or_else(|| "권한이 없습니다".into()),
        404 => msg.unwrap_or_else(|| "찾을 수 없습니다".into()),
        _ => msg.unwrap_or_else(|| format!("요청 실패 ({}) {}", st, t.chars().take(200).collect::<String>())),
    }
}

#[tauri::command]
pub fn cancel_transfer(id: String) { if let Ok(mut s) = canceled().lock() { s.insert(id); } }

/// URL → 로컬 파일. 받는 중에는 "<경로>.fm2part"에 쓰고, 가능하면 이어받습니다.
#[tauri::command]
pub async fn http_download(id: String, url: String, headers: Vec<(String, String)>, nas: Option<NasAuth>, dest: String, on_progress: Channel<u64>) -> Result<String, String> {
    let part = format!("{}.fm2part", dest);
    if let Some(d) = PathBuf::from(&part).parent() { tokio::fs::create_dir_all(d).await.map_err(|e| e.to_string())?; }
    let have = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
    let c = client_for(&nas)?;
    let mut rb = apply(c.get(&url), &url, &headers, &nas)?;
    if have > 0 { rb = rb.header("Range", format!("bytes={}-", have)); }
    let r = rb.send().await.map_err(|e| format!("연결 실패: {}", e))?;
    if !r.status().is_success() { return Err(err_text(r).await); }
    let resumed = have > 0 && r.status().as_u16() == 206;
    let mut f = if resumed {
        tokio::fs::OpenOptions::new().append(true).open(&part).await
    } else {
        tokio::fs::File::create(&part).await
    }.map_err(|e| e.to_string())?;
    let mut done = if resumed { have } else { 0 };
    let _ = on_progress.send(done);
    let mut stream = r.bytes_stream();
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        if is_canceled(&id) {
            drop(f); let _ = tokio::fs::remove_file(&part).await;
            canceled().lock().map(|mut s| s.remove(&id)).ok();
            return Err("__canceled".into());
        }
        let b = chunk.map_err(|e| format!("받는 중 끊김: {}", e))?;
        f.write_all(&b).await.map_err(|e| e.to_string())?;
        done += b.len() as u64;
        if last.elapsed().as_millis() > 200 { let _ = on_progress.send(done); last = std::time::Instant::now(); }
    }
    f.flush().await.map_err(|e| e.to_string())?;
    drop(f);
    let _ = on_progress.send(done);
    crate::finish_to(dest)
}

/// 로컬 파일 → URL (PUT/POST, 스트리밍). 응답 본문을 문자열로 돌려줍니다.
#[tauri::command]
pub async fn http_upload(id: String, url: String, method: String, headers: Vec<(String, String)>, nas: Option<NasAuth>, src: String, on_progress: Channel<u64>) -> Result<String, String> {
    let file = tokio::fs::File::open(&src).await.map_err(|e| e.to_string())?;
    let size = file.metadata().await.map_err(|e| e.to_string())?.len();
    let idc = id.clone();
    let mut sent: u64 = 0;
    let mut last = std::time::Instant::now();
    let prog = on_progress.clone();
    let stream = tokio_util::io::ReaderStream::with_capacity(file, 256 * 1024).map(move |r| {
        if is_canceled(&idc) { return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "__canceled")); }
        if let Ok(b) = &r {
            sent += b.len() as u64;
            if last.elapsed().as_millis() > 200 { let _ = prog.send(sent); last = std::time::Instant::now(); }
        }
        r
    });
    let c = client_for(&nas)?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let rb = apply(c.request(m, &url), &url, &headers, &nas)?
        .header("Content-Length", size.to_string())
        .body(reqwest::Body::wrap_stream(stream));
    let r = rb.send().await.map_err(|e| {
        if is_canceled(&id) { canceled().lock().map(|mut s| s.remove(&id)).ok(); "__canceled".to_string() } else { format!("보내는 중 끊김: {}", e) }
    })?;
    if !r.status().is_success() { return Err(err_text(r).await); }
    let _ = on_progress.send(size);
    Ok(r.text().await.unwrap_or_default())
}

// ---------------- NAS (WebDAV) ----------------
#[tauri::command]
pub fn nas_save_password(id: String, password: String, root: String) -> Result<(), String> {
    let r = norm_root(&root)?;
    let v = serde_json::json!({ "v": 2, "root": r.to_string(), "pw": password }).to_string();
    keyring::Entry::new(KEYRING_SERVICE, &id).and_then(|e| e.set_password(&v)).map_err(|e| format!("{} 저장 실패: {}", crate::secret_store_name(), e))
}
#[tauri::command]
pub fn nas_forget(id: String) { if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, &id) { let _ = e.delete_credential(); } }
/// (묶인 주소, 비밀번호). 0.2.x에서 주소 없이 저장된 비밀번호는 현재 등록 주소에 묶어 다시 저장합니다.
fn nas_secret(n: &NasAuth) -> Result<(String, String), String> {
    let e = keyring::Entry::new(KEYRING_SERVICE, &n.id).map_err(|e| e.to_string())?;
    let raw = e.get_password().map_err(|_| "저장된 NAS 비밀번호가 없습니다. NAS 설정에서 다시 입력해 주세요".to_string())?;
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
        if v.get("v").and_then(|x| x.as_i64()) == Some(2) {
            let root = v.get("root").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let pw = v.get("pw").and_then(|x| x.as_str()).unwrap_or("").to_string();
            return Ok((root, pw));
        }
    }
    if n.root.is_empty() { return Err("NAS 주소 정보가 없습니다. NAS 설정에서 비밀번호를 다시 입력해 주세요".into()); }
    let r = norm_root(&n.root)?.to_string();
    let _ = e.set_password(&serde_json::json!({ "v": 2, "root": r, "pw": raw }).to_string());
    Ok((r, raw))
}

#[derive(Serialize)]
pub struct DavItem { name: String, url: String, dir: bool, size: u64, mtime: i64 }

#[tauri::command]
pub async fn webdav_list(url: String, nas: NasAuth) -> Result<Vec<DavItem>, String> {
    let c = nas_client(nas.insecure)?;
    let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:displayname/></d:prop></d:propfind>"#;
    let rb = apply(c.request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url), &url, &[], &Some(nas.clone()))?
        .header("Depth", "1").header("Content-Type", "application/xml; charset=utf-8").body(body);
    let r = rb.send().await.map_err(|e| format!("NAS에 연결할 수 없습니다: {}", e))?;
    if r.status().is_redirection() { return Err("NAS가 다른 주소로 이동을 요청했습니다. 보안을 위해 따라가지 않습니다 (주소·포트·https 확인)".into()); }
    if !r.status().is_success() { return Err(err_text(r).await); }
    let base = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let scope_root = norm_root(&nas_secret(&nas)?.0)?;
    let text = r.text().await.map_err(|e| e.to_string())?;
    let doc = roxmltree::Document::parse(&text).map_err(|e| format!("WebDAV 응답을 읽지 못했습니다: {}", e))?;
    let mut out = Vec::new();
    for resp in doc.descendants().filter(|n| n.tag_name().name() == "response") {
        let href = resp.descendants().find(|n| n.tag_name().name() == "href").and_then(|n| n.text()).unwrap_or("").trim().to_string();
        let full = match base.join(&href) { Ok(u) => u, Err(_) => continue };
        if !in_scope(&scope_root, full.as_str()) { continue; } // NAS가 범위 밖 주소를 돌려주면 버림
        if full.path().trim_end_matches('/') == base.path().trim_end_matches('/') { continue; }
        let dir = resp.descendants().any(|n| n.tag_name().name() == "collection");
        let size = resp.descendants().find(|n| n.tag_name().name() == "getcontentlength").and_then(|n| n.text()).and_then(|t| t.trim().parse().ok()).unwrap_or(0);
        let mtime = resp.descendants().find(|n| n.tag_name().name() == "getlastmodified").and_then(|n| n.text())
            .and_then(|t| httpdate(t.trim())).unwrap_or(0);
        let seg = full.path().trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
        let name = percent_encoding::percent_decode_str(&seg).decode_utf8_lossy().to_string();
        if name.is_empty() { continue; }
        out.push(DavItem { name, url: full.to_string(), dir, size, mtime });
    }
    Ok(out)
}

#[tauri::command]
pub async fn webdav_op(method: String, url: String, destination: Option<String>, nas: NasAuth) -> Result<(), String> {
    let c = nas_client(nas.insecure)?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    if !["MKCOL", "MOVE", "DELETE", "COPY"].contains(&m.as_str()) { return Err("허용되지 않은 NAS 요청입니다".into()); }
    if let Some(d) = &destination { if !in_scope(&norm_root(&nas_secret(&nas)?.0)?, d) { return Err("등록한 NAS 주소 밖으로는 옮길 수 없습니다".into()); } }
    let mut rb = apply(c.request(m, &url), &url, &[], &Some(nas))?;
    if let Some(d) = destination { rb = rb.header("Destination", d).header("Overwrite", "F"); }
    let r = rb.send().await.map_err(|e| format!("NAS 요청 실패: {}", e))?;
    if !r.status().is_success() { return Err(err_text(r).await); }
    Ok(())
}

// "Tue, 15 Nov 1994 08:12:31 GMT" → epoch ms (간단 파서)
fn httpdate(s: &str) -> Option<i64> {
    let p: Vec<&str> = s.split_whitespace().collect();
    if p.len() < 5 { return None; }
    let day: i64 = p[1].parse().ok()?;
    let mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].iter().position(|m| *m == p[2])? as i64 + 1;
    let year: i64 = p[3].parse().ok()?;
    let t: Vec<i64> = p[4].split(':').filter_map(|x| x.parse().ok()).collect();
    if t.len() != 3 { return None; }
    let (y, m) = if mon <= 2 { (year - 1, mon + 9) } else { (year, mon - 3) };
    let era = y.div_euclid(400); let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1; let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400) + t[0] * 3600 + t[1] * 60 + t[2]) * 1000)
}

// ---------------- 로그인 토큰 (운영체제 보안 저장소: Windows 자격 증명 관리자 / macOS 키체인 / 리눅스 비밀 서비스) ----------------
const TOKEN_SERVICE: &str = "FileManager2PC-Session";
#[tauri::command]
pub fn secret_get(key: String) -> Option<String> {
    keyring::Entry::new(TOKEN_SERVICE, &key).ok().and_then(|e| e.get_password().ok())
}
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(TOKEN_SERVICE, &key).and_then(|e| e.set_password(&value)).map_err(|e| format!("자격 증명 저장 실패: {}", e))
}
#[tauri::command]
pub fn secret_del(key: String) {
    if let Ok(e) = keyring::Entry::new(TOKEN_SERVICE, &key) { let _ = e.delete_credential(); }
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    fn r(u: &str) -> reqwest::Url { norm_root(u).unwrap() }
    #[test] fn scope() {
        let root = r("https://nas.example.com:5006/home");
        assert!(in_scope(&root, "https://nas.example.com:5006/home/"));
        assert!(in_scope(&root, "https://nas.example.com:5006/home/a/b.txt"));
        assert!(in_scope(&root, "https://NAS.example.com:5006/home/x"));
        assert!(!in_scope(&root, "https://evil.example.com:5006/home/x"));
        assert!(!in_scope(&root, "https://nas.example.com:5007/home/x"));
        assert!(!in_scope(&root, "http://nas.example.com:5006/home/x"));
        assert!(!in_scope(&root, "https://nas.example.com:5006/homeX/x"));
        assert!(!in_scope(&root, "https://nas.example.com:5006/other/x"));
        assert!(!in_scope(&root, "https://nas.example.com:5006/home/../etc"));
        assert!(!in_scope(&root, "https://nas.example.com:5006/home/%2e%2e/etc"));
        assert!(!in_scope(&root, "https://nas.example.com:5006/home/a%2fb"));
        assert!(!in_scope(&root, "https://u:p@nas.example.com:5006/home/x"));
        assert!(!in_scope(&root, "https://nas.example.com:5006@evil.com/home/x"));
        let base = reqwest::Url::parse("https://nas.example.com:5006/home/").unwrap();
        assert!(!in_scope(&root, base.join("https://evil.com/home/x").unwrap().as_str()));
        assert!(!in_scope(&root, base.join("//evil.com/home/x").unwrap().as_str()));
        assert!(in_scope(&root, base.join("/home/sub/").unwrap().as_str()));
    }
    #[test] fn transport() {
        assert!(transport_problem(&r("http://192.168.0.10:5005/"), false).is_none());
        assert!(transport_problem(&r("https://192.168.0.10:5006/"), true).is_none());
        assert!(transport_problem(&r("http://mynas.synology.me:5005/"), false).is_some());
        assert!(transport_problem(&r("https://mynas.synology.me:5006/"), true).is_some());
        assert!(transport_problem(&r("https://mynas.synology.me:5006/"), false).is_none());
        assert!(transport_problem(&r("http://8.8.8.8/"), false).is_some());
        assert!(transport_problem(&r("http://172.20.1.1/"), false).is_none());
        assert!(transport_problem(&r("http://172.32.1.1/"), false).is_some());
    }
}
