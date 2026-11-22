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
    const item = {
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
  return (await fetchReleases()).map(({ version, publishedAt, notes, size, sha256, url }) => ({ version, publishedAt, notes, size, sha256, url }));
}
