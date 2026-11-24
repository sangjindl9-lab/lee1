# 앱 화면(홈·압축하기)을 언어별로 다시 그려 스토어용 1080x2160 스크린샷을 만든다.
# 문구는 i18n/tr.txt(앱과 같은 번역표)에서 가져오므로 실제 앱 화면과 같은 글자가 들어간다.
import json, re, glob, html, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ['en', 'ja', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'hi']
keys = []
for fn in sorted(glob.glob(ROOT + '/src/kr/allzip/**/*.java', recursive=True)):
    if fn.endswith('/L.java'): continue
    for m in re.finditer(r'L\.[tf]\("((?:[^"\\]|\\.)*)"', open(fn, encoding='utf-8').read()):
        if m.group(1) not in keys: keys.append(m.group(1))
rows = [l.rstrip('\n') for l in open(ROOT + '/i18n/tr.txt', encoding='utf-8') if not l.startswith('#')]
TR = {l: {} for l in LANGS}
for k, r in zip(keys, rows):
    for l, v in zip(LANGS, r.split(' ‖ ')):
        TR[l][k.replace('\\n', '\n')] = v.replace('\\n', '\n')
HEADS = json.load(open(ROOT + '/shots/heads.json', encoding='utf-8'))

def page(lang, screen):
    t = lambda k: html.escape(TR[lang][k])
    f = lambda k, *a: html.escape(TR[lang][k] % a)
    head, sub = HEADS[lang][screen]
    if screen == 0:
        body = f'''
<div class="hero"><img src="logo.png"><div><div class="nm"><span>Eum</span><i>ZIP</i></div><div class="hs">{t("압축 풀기와 압축하기를 한 번에")}</div></div></div>
<div class="pad">
 <div class="big pri"><b>{t("📂  압축 풀기")}</b><small>{t("ZIP · 7Z · RAR · TAR · GZ 등 압축 파일 선택")}</small></div>
 <div class="big"><b>{t("🗜  파일 압축하기")}</b><small>{t("여러 파일을 골라 하나로 압축")}</small></div>
 <div class="big"><b>{t("📁  폴더 압축하기")}</b><small>{t("폴더를 통째로 압축")}</small></div>
 <div class="card"><h4>{t("풀 수 있는 형식")}</h4><p>ZIP, 7Z, RAR(RAR4·RAR5), TAR, GZ, TGZ, BZ2, TBZ2, XZ, TXZ, LZMA, Z, LZ4, Snappy(SZ), Brotli(BR), Deflate(ZZ), CPIO, AR, DEB, ARJ, DUMP<br>{t("ZIP 계열: JAR, APK, XAPK, AAR, WAR, EPUB, CBZ, DOCX·XLSX·PPTX·HWPX 등")}<br>{t("암호 걸린 ZIP(AES·ZipCrypto) · 7Z · RAR, 한글 파일 이름 깨짐 자동 보정")}</p>
 <h4 style="margin-top:22px">{t("만들 수 있는 형식")}</h4><p>{t("ZIP(암호 가능), 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, TAR.LZ4, TAR.LZMA, CPIO")}<br>{t("파일 1개 전용: GZ, BZ2, XZ, LZMA, LZ4, SZ, ZZ")}</p></div>
 <div class="note">{t("분할 압축(여러 권)과 Zstandard(.zst)는 아직 지원하지 않습니다.")}</div>
</div>'''
    else:
        body = f'''
<div class="bar"><span>‹</span>{t("압축하기")}</div>
<div class="pad">
 <div class="card"><h4>{t("압축할 대상")}</h4><p class="s">{t("아직 고른 것이 없습니다. 아래 버튼으로 파일이나 폴더를 추가하세요.")}</p>
  <div class="row"><div class="btn2">{t("＋ 파일")}</div><div class="btn2">{t("＋ 폴더")}</div><div class="btn2 red">{t("비우기")}</div></div></div>
 <div class="card"><div class="lab">{t("압축 형식")}</div><div class="sel">{t("ZIP (.zip) · 가장 널리 쓰임, 암호 가능")}</div>
  <div class="lab">{t("압축 수준")}</div><div class="sel">{t("보통 (권장)")}</div>
  <div class="lab">{t("압축 파일 이름 (확장자는 자동으로 붙습니다)")}</div><div class="inp">{t("압축파일")}</div>
  <div class="lab">{t("비밀번호 (선택 · ZIP 전용, 비워 두면 암호 없음)")}</div><div class="inp"> </div>
  <div class="chk"><i></i>{t("윈도우 탐색기에서도 열리는 옛 암호 방식 사용 (보안 약함)")}</div>
  <div class="s sm">{t("기본은 AES-256 암호화입니다. 반디집·알집·7-Zip 등으로 풀 수 있습니다.")}</div></div>
</div>
<div class="bottom"><div class="go">{t("압축하기")}</div><div class="where">{f("‘다운로드 › %s’ 폴더에 저장됩니다", "EumZIP")}</div><div class="go2">{t("저장 위치 직접 선택…")}</div></div>'''
    return f'''<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
@font-face{{font-family:Deva;src:url(noto-sans-devanagari-devanagari-400-normal.woff2);font-weight:400}}
@font-face{{font-family:Deva;src:url(noto-sans-devanagari-devanagari-700-normal.woff2);font-weight:700}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:1080px;height:2160px;overflow:hidden;font-family:{"'Noto Sans CJK JP'," if lang=="ja" else ""}Roboto,'Noto Sans',Deva,'Noto Sans CJK KR',sans-serif;
 background:linear-gradient(160deg,#FFB31A 0%,#F47A00 45%,#DC4A02 100%);color:#35200F}}
.hd{{position:absolute;top:40px;left:40px;right:40px;height:230px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:14px}}
.h1{{white-space:nowrap;color:#fff;font-weight:800;font-size:66px;line-height:1.2;text-shadow:0 4px 10px rgba(0,0,0,.25)}}
.h2{{white-space:nowrap;color:#FFE9A8;font-weight:700;font-size:40px;text-shadow:0 3px 8px rgba(0,0,0,.25)}}
.ph{{position:absolute;top:290px;left:140px;width:800px;height:1840px;border-radius:52px;background:#FFF7EC;overflow:hidden;box-shadow:0 0 0 6px #C24100,0 24px 50px rgba(0,0,0,.3)}}
.st{{height:80px;background:#D94A00;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 40px;font-size:28px;font-weight:600}}
.hero{{display:flex;align-items:center;gap:30px;padding:36px 40px 50px;background:linear-gradient(135deg,#FFB31A,#F47A00 55%,#DC4A02);border-radius:0 0 48px 48px}}
.hero img{{width:160px;height:160px;border-radius:34px}}
.nm{{font-size:62px;font-weight:800;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.4)}} .nm i{{color:#FFE04A;padding-left:4px}}
.hs{{color:#fff;font-size:26px;font-weight:600;margin-top:6px}}
.pad{{padding:30px 32px}}
.big{{background:#fff;border:2px solid #F5DDBF;border-radius:30px;padding:30px 32px;margin-bottom:22px;box-shadow:0 4px 8px rgba(0,0,0,.06)}}
.big b{{display:block;font-size:36px;font-weight:800}} .big small{{display:block;font-size:24px;color:#86695A;margin-top:10px;font-weight:600}}
.big.pri{{background:linear-gradient(135deg,#F98F00,#DC4700);border:0;color:#fff}} .big.pri small{{color:#FFF3D6}}
.card{{background:#fff;border:2px solid #F5DDBF;border-radius:30px;padding:30px 30px;margin-bottom:22px}}
.card h4{{font-size:28px;font-weight:800}} .card p{{font-size:24px;color:#86695A;line-height:1.55;margin-top:10px;font-weight:500}}
.note{{font-size:22px;color:#86695A;margin-top:6px;font-weight:500}}
.bar{{height:124px;background:linear-gradient(90deg,#F58A00,#E25000);color:#fff;font-size:36px;font-weight:800;display:flex;align-items:center;padding:0 36px;gap:30px}} .bar span{{font-size:52px;font-weight:400}}
.s{{color:#86695A;font-size:23px;margin-top:12px;font-weight:500}} .sm{{font-size:21px}}
.row{{display:flex;gap:16px;margin-top:22px}} .btn2{{flex:1;background:#FFEFD2;color:#C24100;font-weight:800;font-size:26px;text-align:center;padding:26px 6px;border-radius:22px}} .btn2.red{{color:#D32F2F}}
.lab{{color:#86695A;font-size:23px;margin:22px 0 10px;font-weight:600}} .lab:first-child{{margin-top:0}}
.sel{{background:#FFFBF5;border:2px solid #F5DDBF;border-radius:20px;padding:18px 24px;font-size:26px;font-weight:600}}
.inp{{border-bottom:2px solid #555;padding:10px 6px;font-size:28px;font-weight:600;min-height:52px}}
.chk{{display:flex;gap:16px;align-items:center;font-size:23px;margin-top:26px;font-weight:600}} .chk i{{width:32px;height:32px;border:3px solid #555;border-radius:5px;flex:none}}
.bottom{{position:absolute;left:0;right:0;bottom:90px;padding:0 32px;background:#fff;padding-top:20px}}
.go{{background:linear-gradient(90deg,#F78A00,#DF4A00);color:#fff;font-weight:800;font-size:30px;text-align:center;padding:26px;border-radius:26px}}
.where{{text-align:center;font-size:21px;color:#86695A;margin:12px 0 16px;font-weight:600}}
.go2{{background:#FFEFD2;color:#C24100;font-weight:800;font-size:28px;text-align:center;padding:26px;border-radius:26px;margin-bottom:10px}}
.nav{{position:absolute;left:0;right:0;bottom:0;height:90px;background:#fff;display:flex;justify-content:space-around;align-items:center;font-size:40px;color:#444}}
</style></head><body>
<div class="hd"><div class="h1">{html.escape(head)}</div><div class="h2">{html.escape(sub)}</div></div>
<div class="ph"><div class="st"><span>4:28</span><span>▾ ◢ ▮ 82%</span></div>{body}<div class="nav"><span>≡</span><span>▢</span><span>‹</span></div></div>
<script>for(const c of ['h1','h2']){{const e=document.querySelector('.'+c);let f=parseFloat(getComputedStyle(e).fontSize);while(e.scrollWidth>1000&&f>24){{f-=2;e.style.fontSize=f+'px';}}}}</script>
</body></html>'''

out = ROOT + '/shots/out'
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1080, 'height': 2160})
    for lang in (sys.argv[1:] or LANGS):
        for s in (0, 1):
            fn = ROOT + '/shots/_page.html'
            open(fn, 'w', encoding='utf-8').write(page(lang, s))
            pg.goto('file://' + fn)
            pg.wait_for_timeout(300)
            pg.screenshot(path=f'{out}/{lang}-{s + 1}.png')
            print(lang, s + 1)
    b.close()
