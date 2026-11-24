// 파일 관리자 2 PC — 로컬 파일 입출력만 담당. 서버 통신과 화면은 웹뷰(React)에서 처리합니다.
mod net;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct LocalFile {
    path: String,
    name: String,
    size: u64,
    dir: bool,
}

#[derive(Serialize)]
struct SysInfo {
    name: String,
    os: String,
    downloads: String,
    /// 서버에 보낼 기기 종류 이름 ("Windows PC" / "Mac" / "Linux PC")
    model: String,
    /// 경로 구분자 (Windows "\\", 그 외 "/")
    sep: String,
}

fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(o) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
            let n = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !n.is_empty() { return n; }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(n) = fs::read_to_string("/etc/hostname") {
            let n = n.trim().to_string();
            if !n.is_empty() { return n; }
        }
    }
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| default_model().into())
}

fn default_model() -> &'static str {
    if cfg!(target_os = "windows") { "Windows PC" } else if cfg!(target_os = "macos") { "Mac" } else { "Linux PC" }
}

#[tauri::command]
fn sys_info(app: tauri::AppHandle) -> SysInfo {
    use tauri::Manager;
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    // 리눅스는 언어 설정에 따라 "다운로드" 폴더 이름이 달라서 XDG 설정을 따르는 Tauri 경로를 먼저 씁니다.
    let downloads = app.path().download_dir().unwrap_or_else(|_| Path::new(&home).join("Downloads")).to_string_lossy().to_string();
    SysInfo {
        name: computer_name(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        downloads,
        model: default_model().into(),
        sep: std::path::MAIN_SEPARATOR.to_string(),
    }
}

#[tauri::command]
fn local_stat(path: String) -> Result<LocalFile, String> {
    let p = PathBuf::from(&path);
    let m = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(LocalFile {
        name: p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
        path,
        size: if m.is_file() { m.len() } else { 0 },
        dir: m.is_dir(),
    })
}

/// 폴더를 올릴 때 하위 파일 목록 (최대 5000개)
#[tauri::command]
fn local_walk(path: String) -> Result<Vec<LocalFile>, String> {
    let mut out = Vec::new();
    let root = PathBuf::from(&path);
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            let m = e.metadata().map_err(|e| e.to_string())?;
            let p = e.path();
            if m.is_dir() {
                stack.push(p);
            } else if m.is_file() {
                let rel = p.strip_prefix(root.parent().unwrap_or(&root)).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                out.push(LocalFile { path: p.to_string_lossy().to_string(), name: rel, size: m.len(), dir: false });
                if out.len() >= 5000 {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_chunk(path: String, offset: u64, length: u64) -> Result<String, String> {
    let mut f = File::open(&path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; length.min(1024 * 1024) as usize];
    let mut n = 0;
    while n < buf.len() {
        let r = f.read(&mut buf[n..]).map_err(|e| e.to_string())?;
        if r == 0 { break; }
        n += r;
    }
    buf.truncate(n);
    Ok(STANDARD.encode(&buf))
}

/// 받는 중인 파일은 "<이름>.fm2part" 에 이어 쓰고, 끝나면 finish_download 로 확정합니다.
#[tauri::command]
fn append_chunk(path: String, offset: u64, b64: String) -> Result<u64, String> {
    let part = format!("{}.fm2part", path);
    if let Some(dir) = Path::new(&part).parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if offset == 0 {
        let _ = fs::remove_file(&part);
    }
    let cur = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if cur != offset {
        return Err(format!("offset_mismatch:{}", cur));
    }
    let data = STANDARD.decode(b64.as_bytes()).map_err(|e| e.to_string())?;
    let mut f = OpenOptions::new().create(true).append(true).open(&part).map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    Ok(cur + data.len() as u64)
}

#[tauri::command]
fn part_size(path: String) -> u64 {
    fs::metadata(format!("{}.fm2part", path)).map(|m| m.len()).unwrap_or(0)
}

/// 같은 이름이 있으면 "이름 (1).확장자" 로 저장. 최종 경로를 돌려줍니다.
#[tauri::command]
fn finish_download(path: String) -> Result<String, String> {
    finish_to(path)
}

pub fn finish_to(path: String) -> Result<String, String> {
    let part = format!("{}.fm2part", path);
    let mut dest = PathBuf::from(&path);
    if dest.exists() {
        let stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = dest.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
        let dir = dest.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let mut i = 1;
        loop {
            let c = dir.join(format!("{} ({}){}", stem, i, ext));
            if !c.exists() { dest = c; break; }
            i += 1;
        }
    }
    fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn cancel_download(path: String) {
    let _ = fs::remove_file(format!("{}.fm2part", path));
}

pub fn secret_store_name() -> &'static str {
    if cfg!(target_os = "windows") { "Windows 자격 증명 관리자" } else if cfg!(target_os = "macos") { "macOS 키체인" } else { "리눅스 비밀번호 저장소(Secret Service)" }
}

#[tauri::command]
fn secret_store() -> &'static str { secret_store_name() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![sys_info, secret_store, local_stat, local_walk, read_chunk, append_chunk, part_size, finish_download, cancel_download,
            net::http_download, net::http_upload, net::cancel_transfer, net::nas_save_password, net::nas_forget, net::webdav_list, net::webdav_op,
            net::secret_get, net::secret_set, net::secret_del])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
