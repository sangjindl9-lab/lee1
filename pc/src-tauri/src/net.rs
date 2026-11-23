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
}

fn client(insecure: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(insecure)
        .user_agent("FileManager2PC")
        .build()
        .map_err(|e| e.to_string())
}

fn apply(mut rb: reqwest::RequestBuilder, headers: &[(String, String)], nas: &Option<NasAuth>) -> Result<reqwest::RequestBuilder, String> {
    for (k, v) in headers { rb = rb.header(k, v); }
    if let Some(n) = nas {
        let pw = nas_password(&n.id)?;
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
    let c = client(nas.as_ref().map(|n| n.insecure).unwrap_or(false))?;
    let mut rb = apply(c.get(&url), &headers, &nas)?;
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
    let c = client(nas.as_ref().map(|n| n.insecure).unwrap_or(false))?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let rb = apply(c.request(m, &url), &headers, &nas)?
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
pub fn nas_save_password(id: String, password: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &id).and_then(|e| e.set_password(&password)).map_err(|e| format!("Windows 자격 증명 저장 실패: {}", e))
}
#[tauri::command]
pub fn nas_forget(id: String) { if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, &id) { let _ = e.delete_credential(); } }
fn nas_password(id: &str) -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, id).and_then(|e| e.get_password()).map_err(|_| "저장된 NAS 비밀번호가 없습니다. NAS 설정에서 다시 입력해 주세요".into())
}

#[derive(Serialize)]
pub struct DavItem { name: String, url: String, dir: bool, size: u64, mtime: i64 }

#[tauri::command]
pub async fn webdav_list(url: String, nas: NasAuth) -> Result<Vec<DavItem>, String> {
    let c = client(nas.insecure)?;
    let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:displayname/></d:prop></d:propfind>"#;
    let rb = apply(c.request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url), &[], &Some(nas.clone()))?
        .header("Depth", "1").header("Content-Type", "application/xml; charset=utf-8").body(body);
    let r = rb.send().await.map_err(|e| format!("NAS에 연결할 수 없습니다: {}", e))?;
    if !r.status().is_success() { return Err(err_text(r).await); }
    let base = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let text = r.text().await.map_err(|e| e.to_string())?;
    let doc = roxmltree::Document::parse(&text).map_err(|e| format!("WebDAV 응답을 읽지 못했습니다: {}", e))?;
    let mut out = Vec::new();
    for resp in doc.descendants().filter(|n| n.tag_name().name() == "response") {
        let href = resp.descendants().find(|n| n.tag_name().name() == "href").and_then(|n| n.text()).unwrap_or("").trim().to_string();
        let full = match base.join(&href) { Ok(u) => u, Err(_) => continue };
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
    let c = client(nas.insecure)?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut rb = apply(c.request(m, &url), &[], &Some(nas))?;
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
