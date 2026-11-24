import { q } from './db.js';

// PC 설치 파일은 GitHub Releases(태그 fm2-pc-v*)에서 가져옵니다.
// 0.4.0부터 한 릴리스에 Windows(.exe)·macOS(.dmg + 업데이트용 .app.tar.gz)·Linux(.deb/.rpm/.AppImage)가 함께 올라갑니다.
const REPO = process.env.RELEASE_REPO || 'sangjindl9-lab/lee1';
const PREFIX = 'fm2-pc-v';
const UA = { 'User-Agent': 'fm2-connect' };
let cache = { at: 0, list: [] };

// 종류별 파일 찾기 규칙
const KINDS = {
  windows: [/setup\.exe$/i, /\.exe$/i, /\.msi$/i],
  mac: [/\.dmg$/i],
  macUpdate: [/\.app\.tar\.gz$/i],
  appimage: [/\.AppImage$/i],
  deb: [/\.deb$/i],
  rpm: [/\.rpm$/i],
};
export const OS_LABEL = {
  windows: 'Windows 10 / 11 (64비트)',
  mac: 'macOS 11 이상 (Intel · Apple Silicon 공용)',
  linux: 'Linux 64비트 (Ubuntu·Debian·Fedora 등)',
};
// Tauri 업데이터 플랫폼 키 → 업데이트 파일 종류
const UPDATER = { 'windows-x86_64': 'windows', 'darwin-aarch64': 'macUpdate', 'darwin-x86_64': 'macUpdate', 'linux-x86_64': 'appimage' };

async function text(url) {
  try { const r = await fetch(url, { headers: UA }); return r.ok ? (await r.text()).trim() : null; } catch { return null; }
}

async function fileInfo(rel, asset) {
  const find = (n) => rel.assets.find((a) => a.name === n);
  let sha256 = null;
  const shaAsset = find(asset.name + '.sha256');
  if (shaAsset) sha256 = ((await text(shaAsset.browser_download_url)) || '').match(/[a-f0-9]{64}/i)?.[0] || null;
  let signature = null;
  const sigAsset = find(asset.name + '.sig');
  if (sigAsset) signature = await text(sigAsset.browser_download_url);
  // 릴리스에 .sig가 없으면 저장소에 커밋된 서명 사용 (서명은 공개 정보, 검증은 앱이 공개키로 함)
  if (!signature) signature = await text(`https://raw.githubusercontent.com/${REPO}/${process.env.SIG_BRANCH || 'filemanager2'}/pc/signatures/${encodeURIComponent(asset.name)}.sig`);
  return { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256, signature: signature || null };
}

async function fetchReleases() {
  if (Date.now() - cache.at < 10 * 60e3 && cache.list.length) return cache.list;
  const headers = { ...UA, Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers });
  if (!r.ok) { console.error('github releases', r.status); return cache.list; }
  const all = await r.json();
  const list = [];
  for (const rel of all) {
    if (rel.draft || rel.prerelease || !String(rel.tag_name).startsWith(PREFIX)) continue;
    const files = {};
    for (const [kind, pats] of Object.entries(KINDS)) {
      let a = null;
      for (const p of pats) { a = rel.assets.find((x) => p.test(x.name)); if (a) break; }
      if (a) files[kind] = await fileInfo(rel, a);
    }
    if (!files.windows && !files.mac && !files.appimage && !files.deb && !files.rpm) continue;
    const item = { version: String(rel.tag_name).slice(PREFIX.length), publishedAt: rel.published_at, notes: rel.body || '', files };
    list.push(item);
    for (const [plat, f] of [['windows', files.windows], ['mac', files.mac], ['linux', files.appimage || files.deb || files.rpm]]) {
      if (!f) continue;
      q(`INSERT INTO app_releases(platform, version, url, sha256, size, notes, published_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (platform, version) DO UPDATE SET url=EXCLUDED.url, sha256=EXCLUDED.sha256, size=EXCLUDED.size, notes=EXCLUDED.notes`,
        [plat, item.version, f.url, f.sha256, f.size, item.notes, item.publishedAt]).catch(() => {});
    }
  }
  cache = { at: Date.now(), list };
  return list;
}

const strip = (f) => f && { name: f.name, url: f.url, size: f.size, sha256: f.sha256 };

/** 플랫폼별 최신 파일. plat: windows | mac | linux */
export async function latestFor(plat) {
  const l = await fetchReleases();
  for (const r of l) {
    const f = plat === 'linux' ? (r.files.appimage || r.files.deb || r.files.rpm) : r.files[plat];
    if (f) return { version: r.version, publishedAt: r.publishedAt, notes: r.notes, ...f, os: OS_LABEL[plat], files: r.files };
  }
  return null;
}

/** 리눅스 형식별 최신 파일 (deb | rpm | appimage) */
export async function latestLinux(fmt) {
  for (const r of await fetchReleases()) if (r.files[fmt]) return { version: r.version, ...r.files[fmt] };
  return null;
}

// 0.3.x 이전 화면 호환: Windows 정보 + 모든 플랫폼 요약
export async function latestWindowsRelease() {
  const w = await latestFor('windows');
  const m = await latestFor('mac');
  const lx = await latestFor('linux');
  if (!w && !m && !lx) return null;
  const base = w || m || lx;
  const { files, signature, ...rest } = base; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    msiUrl: null,
    platforms: {
      windows: w && { version: w.version, publishedAt: w.publishedAt, os: OS_LABEL.windows, ...strip(w.files.windows) },
      mac: m && { version: m.version, publishedAt: m.publishedAt, os: OS_LABEL.mac, ...strip(m.files.mac) },
      linux: lx && { version: lx.version, publishedAt: lx.publishedAt, os: OS_LABEL.linux,
        appimage: strip(lx.files.appimage), deb: strip(lx.files.deb), rpm: strip(lx.files.rpm) },
    },
  };
}

export async function releaseHistory() {
  return (await fetchReleases()).map(({ version, publishedAt, notes, files }) => {
    const main = files.windows || files.mac || files.appimage || files.deb || files.rpm;
    return {
      version, publishedAt, notes, size: main.size, sha256: main.sha256, url: main.url, name: main.name,
      platforms: [files.windows && 'Windows', files.mac && 'macOS', (files.appimage || files.deb || files.rpm) && 'Linux'].filter(Boolean),
      files: Object.fromEntries(Object.entries(files).filter(([k]) => k !== 'macUpdate').map(([k, f]) => [k, strip(f)])),
    };
  });
}

function manifestFrom(r, keys) {
  const platforms = {};
  for (const k of keys) {
    const f = r.files[UPDATER[k]];
    if (f && f.signature) platforms[k] = { signature: f.signature, url: f.url };
  }
  if (!Object.keys(platforms).length) return null;
  return { version: r.version, notes: r.notes, pub_date: r.publishedAt, platforms };
}

// Tauri 업데이터용 JSON (서명이 있는 배포만 제공 — 서명 없는 업데이트는 내려주지 않음)
// 0.3.x 이하 앱(모두 Windows)이 쓰는 고정 주소 → Windows의 서명된 최신 버전
export async function tauriUpdateManifest() {
  return tauriUpdateFor('windows', 'x86_64');
}

/** 0.4.0부터 쓰는 플랫폼별 주소 (/api/pc/update/{target}/{arch}.json) — 그 플랫폼의 서명된 최신 버전 */
export async function tauriUpdateFor(target, arch) {
  const key = `${target}-${arch}`;
  if (!UPDATER[key]) return null;
  for (const r of await fetchReleases()) {
    const m = manifestFrom(r, [key]);
    if (m) return m;
  }
  return null;
}
