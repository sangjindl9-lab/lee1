# 화면 검증 (Playwright). 시연 데이터가 들어 있는 서버에서 실행: BASE=http://localhost:3000 python3 test/verify-ui.py
import asyncio, os, json, io
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
PW = os.environ.get('ADMIN_PASSWORD', 'admin1234!')
DEMO_PW = os.environ.get('DEMO_PASSWORD', 'demo1234!')
OUT = os.environ.get('OUT', '/tmp/ui-verify')
os.makedirs(OUT, exist_ok=True)
results = []
def ok(no, name, passed, detail=''):
    results.append({'no': no, 'name': name, 'pass': bool(passed), 'detail': detail})
    print(('통과' if passed else '실패'), f'[{no}] {name} — {detail}')

async def login(pg, u, p):
    await pg.goto(BASE + '/#/login')
    await pg.fill('input[autocomplete=username]', u); await pg.fill('input[type=password]', p)
    await pg.click('button[type=submit]'); await pg.wait_for_timeout(900)

# 표시 점 중심 주변에 도면 기호(진한 선)가 있는지 픽셀로 확인 (오버레이를 숨기고 캔버스만 검사)
DARK_NEAR = """([cx, cy]) => {
  const c = document.querySelector('.v-stage canvas'); const r = c.getBoundingClientRect();
  const k = c.width / r.width; const ctx = c.getContext('2d');
  const d = ctx.getImageData(Math.round(cx*k)-Math.round(12*k), Math.round(cy*k)-Math.round(12*k), Math.round(24*k), Math.round(24*k)).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i+1] < 90 && d[i+2] < 90) n++;
  return n;
}"""
MARK_POS = """(id) => {
  const m = window.__viewerMarks || null; return null;
}"""

async def mark_center(pg, mgmt):
    # SVG 라벨 텍스트로 해당 표시의 원 중심 찾기
    return await pg.evaluate("""(mgmt) => {
      for (const g of document.querySelectorAll('.v-stage svg g')) {
        const t = g.querySelector('text'); if (!t || !t.textContent.startsWith(mgmt)) continue;
        const cs = [...g.querySelectorAll('circle')]; const c = cs[cs.length-1]; if (!c) return null;
        return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
      } return null; }""", mgmt)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg, 'admin', PW)
        drawings = await (await pg.request.get(BASE + '/api/sites/1/drawings')).json()
        revA = drawings[0]['revisions'][-1]['id']

        # ---- 2. 확대·축소·회전·페이지 이동 후 위치 일치 ----
        await pg.goto(f'{BASE}/#/s/1/viewer/{revA}'); await pg.wait_for_timeout(2500)
        checks = []
        async def check(label, mgmt='LP-1'):
            await pg.wait_for_timeout(900)
            c = await mark_center(pg, mgmt)
            n = await pg.evaluate(DARK_NEAR, c) if c else 0
            checks.append((label, n)); return n
        await check('맞춤')
        for _ in range(3): await pg.click('button:has-text("확대")')
        await check('확대 x1.95')
        await pg.click('button:has-text("축소")'); await check('축소')
        await pg.click('button:has-text("회전")'); await check('회전 90°')
        await pg.click('button:has-text("회전")'); await check('회전 180°')
        await pg.click('button:has-text("회전")'); await pg.click('button:has-text("회전")')
        await pg.click('button:has-text("다음")'); await check('2쪽', 'CCTV-02')
        await pg.click('button:has-text("이전")'); await check('1쪽 복귀')
        await pg.screenshot(path=f'{OUT}/viewer_after_zoom.png')
        ok(2, '확대·축소·회전·페이지 이동 후 표시 위치 일치', all(n > 10 for _, n in checks), ', '.join(f'{l}: 기호 픽셀 {n}' for l, n in checks))

        # ---- 3. 도면 객체 선택 ↔ 목록 이동 (양방향) + 겹친 선 후보 ----
        await pg.click('button:has-text("맞춤")'); await pg.wait_for_timeout(800)
        c = await mark_center(pg, 'LD-P1')
        box = await pg.locator('.v-stage svg').bounding_box()
        await pg.mouse.click(box['x'] + c[0], box['y'] + c[1]); await pg.wait_for_timeout(1200)
        card_title = await pg.locator('.v-right .mgmt').first.inner_text()
        # 겹친 선 (PC-001, PC-002 가 y=0.49 에서 겹침)
        sw, sh = box['width'], box['height']
        await pg.mouse.click(box['x'] + sw * 0.40, box['y'] + sh * 0.49); await pg.wait_for_timeout(600)
        cand = await pg.locator('.cand div:not(.h)').all_inner_texts()
        await pg.screenshot(path=f'{OUT}/viewer_candidates.png')
        # 목록 → 도면
        await pg.goto(f'{BASE}/#/s/1/power'); await pg.wait_for_timeout(1000)
        await pg.locator('tr:has-text("PC-001") a:has-text("곳")').click(); await pg.wait_for_timeout(2500)
        bar = await pg.locator('.v-right').inner_text()
        await pg.screenshot(path=f'{OUT}/list_to_drawing.png')
        ok(3, '도면 객체 선택과 목록의 도면 이동 양방향', card_title.startswith('LD-P1') and any('PC-001' in x for x in cand) and any('PC-002' in x for x in cand) and '도면 표시' in bar and 'PC-001' in bar,
           f'도면 클릭 → 카드 {card_title.split()[0]}, 겹친 선 후보 {cand}, 목록 → 도면 표시 선택됨 ({"도면상 추정길이" in bar and "추정길이 표시" or ""})')

        # ---- 10. 모바일 QR 조회·사진 등록 (실패 후 재시도) ----
        card = await (await pg.request.get(BASE + '/api/assets/3')).json()
        token = card['asset']['qr_token']
        m = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mp = await m.new_page()
        await mp.goto(f'{BASE}/q/{token}'); await mp.wait_for_timeout(800)
        on_login = '#/login' in mp.url
        await mp.fill('input[autocomplete=username]', 'demo_worker'); await mp.fill('input[type=password]', DEMO_PW)
        await mp.click('button[type=submit]'); await mp.wait_for_timeout(1500)
        landed = '#/m/asset/3' in mp.url
        await mp.click('button:has-text("사진 촬영·등록")')
        from PIL import Image
        img = Image.new('RGB', (320, 240), (90, 110, 130)); buf = io.BytesIO(); img.save(buf, 'JPEG')
        await mp.locator('input[type=file][capture]').first.set_input_files(files=[{'name': 'field.jpg', 'mimeType': 'image/jpeg', 'buffer': buf.getvalue()}])
        await mp.route('**/api/files', lambda r: r.abort())
        await mp.click('button.primary:has-text("저장")'); await mp.wait_for_timeout(800)
        fail_txt = await mp.locator('.upload-item').inner_text()
        await mp.screenshot(path=f'{OUT}/mobile_fail.png', full_page=False)
        await mp.unroute('**/api/files')
        await mp.click('.upload-item button:has-text("재시도")'); await mp.wait_for_timeout(1200)
        ok_txt = await mp.locator('.upload-item').inner_text()
        after = await (await mp.request.get(BASE + '/api/assets/3')).json()
        saved = any(f['orig_name'] == 'field.jpg' for f in after['files'])
        ok(10, 'QR 조회와 모바일 사진 등록 (실패 표시·재시도)', on_login and landed and '저장 실패' in fail_txt and '저장됨' in ok_txt and saved,
           f'비로그인 QR → 로그인 화면 {on_login}, 로그인 후 카드 {landed}, 통신 차단 시 "{fail_txt.splitlines()[-1][:40]}", 재시도 후 "{ok_txt.splitlines()[-1]}", 서버 저장 {saved}')

        print('PAGE ERRORS', errs)
        await b.close()
    json.dump(results, open(f'{OUT}/ui-results.json', 'w'), ensure_ascii=False, indent=2)

asyncio.run(main())
