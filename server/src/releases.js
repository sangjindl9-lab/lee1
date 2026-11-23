import { q } from './db.js';

// Windows 설치 파일은 GitHub Releases(태그 fm2-pc-v*)에서 가져옵니다.
const REPO = process.env.RELEASE_REPO || 'sangjindl9-lab/lee1';
const PREFIX = 'fm2-pc-v';
let cache = { at: 0, list: [] };

async function fetchReleases() {
  if (Date.now() - cache.at < 10 * 60e3 && cache.list.length) return cache.list;
  const headers = { 'User-Agent': 'fm2-connect', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers });
  if (!r.ok) { console.error('github releases', r.status); return cache.list; }
  const all = await r.json();
  const list = [];
  for (const rel of all) {
    if (rel.draft || rel.prerelease || !String(rel.tag_name).startsWith(PREFIX)) continue;
    const exe = rel.assets.find((a) => /setup\.exe$/i.test(a.name)) || rel.assets.find((a) => /\.exe$/i.test(a.name));
    const msi = rel.assets.find((a) => /\.msi$/i.test(a.name));
    const main = exe || msi;
    if (!main) continue;
    let sha256 = null;
    const shaAsset = rel.assets.find((a) => a.name === main.name + '.sha256');
    if (shaAsset) {
      try {
        const t = await (await fetch(shaAsset.browser_download_url, { headers: { 'User-Agent': 'fm2-connect' } })).text();
        sha256 = (t.match(/[a-f0-9]{64}/i) || [null])[0];
      } catch {}
    }
    let signature = null;
    const sigAsset = rel.assets.find((a) => a.name === main.name + '.sig');
    if (sigAsset) {
      try { signature = (await (await fetch(sigAsset.browser_download_url, { headers: { 'User-Agent': 'fm2-connect' } })).text()).trim(); } catch {}
    }
    if (!signature) {
      // 릴리스에 .sig가 없으면 저장소에 커밋된 서명 사용 (서명은 공개 정보, 검증은 앱이 공개키로 함)
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${process.env.SIG_BRANCH || 'filemanager2'}/pc/signatures/${encodeURIComponent(main.name)}.sig`, { headers: { 'User-Agent': 'fm2-connect' } });
        if (r.ok) signature = (await r.text()).trim();
      } catch {}
    }
    const item = {
      signature,
      version: String(rel.tag_name).slice(PREFIX.length),
      name: main.name, url: main.browser_download_url, size: main.size,
      msiUrl: msi && msi !== main ? msi.browser_download_url : null,
      sha256, publishedAt: rel.published_at, notes: rel.body || '',
      os: 'Windows 10 / 11 (64비트)',
    };
    list.push(item);
    q(`INSERT INTO app_releases(platform, version, url, sha256, size, notes, published_at) VALUES ('windows',$1,$2,$3,$4,$5,$6)
       ON CONFLICT (platform, version) DO UPDATE SET url=EXCLUDED.url, sha256=EXCLUDED.sha256, size=EXCLUDED.size, notes=EXCLUDED.notes`,
      [item.version, item.url, item.sha256, item.size, item.notes, item.publishedAt]).catch(() => {});
  }
  cache = { at: Date.now(), list };
  return list;
}

export async function latestWindowsRelease() {
  const l = await fetchReleases();
  return l[0] || null;
}
export async function releaseHistory() {
  return (await fetchReleases()).map(({ version, publishedAt, notes, size, sha256, url, name }) => ({ version, publishedAt, notes, size, sha256, url, name }));
}

// Tauri 업데이터용 JSON (서명이 있는 배포만 제공 — 서명 없는 업데이트는 내려주지 않음)
export async function tauriUpdateManifest() {
  const r = (await fetchReleases()).find((x) => x.signature);
  if (!r) return null;
  return { version: r.version, notes: r.notes, pub_date: r.publishedAt,
    platforms: { 'windows-x86_64': { signature: r.signature, url: r.url } } };
}
