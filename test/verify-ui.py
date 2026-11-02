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

        # ---- 18. 꼭짓점 추가·삭제 ----
        await pg.goto(f'{BASE}/#/s/1/viewer/{revA}'); await pg.wait_for_timeout(2500)
        pc = await (await pg.request.get(BASE + '/api/sites/1/assets?q=PC-001')).json()
        pcid = [a for a in pc if a['mgmt_no'] == 'PC-001'][0]['id']
        async def pc_pts():
            r = await (await pg.request.get(f'{BASE}/api/revisions/{revA}')).json()
            return [m for m in r['marks'] if m['asset_id'] == pcid][0]['geom']['pts']
        before = len(await pc_pts())
        await pg.fill('input[type=search]', 'PC-001'); await pg.press('input[type=search]', 'Enter'); await pg.wait_for_timeout(1800)
        box = await pg.locator('.v-stage svg').bounding_box()
        sw, sh = box['width'], box['height']
        # 첫 선분 (0.10,0.20)-(0.10,0.49) 중간
        await pg.mouse.dblclick(box['x'] + sw * 0.10, box['y'] + sh * 0.35); await pg.wait_for_timeout(1200)
        added = len(await pc_pts())
        await pg.mouse.click(box['x'] + sw * 0.10, box['y'] + sh * 0.35, button='right'); await pg.wait_for_timeout(1200)
        removed = len(await pc_pts())
        ok(18, '도면 경로 꼭짓점 추가·삭제', added == before + 1 and removed == before, f'꼭짓점 {before} → 더블클릭 추가 {added} → 오른쪽 클릭 삭제 {removed}')

        # ---- 19. 자유 각도 회전 상태에서 선택·위치 ----
        await pg.fill('.v-tools input[type=number]', '17'); await pg.press('.v-tools input[type=number]', 'Enter'); await pg.wait_for_timeout(1000)
        await pg.locator('.v-tools input[type=number]').dispatch_event('change'); await pg.wait_for_timeout(800)
        rect = await pg.evaluate("""() => { for (const g of document.querySelectorAll('.v-stage svg g')) { const t = g.querySelector('text'); if (t && t.textContent.startsWith('LD-P1')) { const c = [...g.querySelectorAll('circle')].pop(); const r = c.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; } } return null; }""")
        await pg.mouse.click(rect[0], rect[1]); await pg.wait_for_timeout(1200)
        sel_title = await pg.locator('.v-right .mgmt').first.inner_text()
        transform = await pg.evaluate("document.querySelector('.v-stage').style.transform")
        await pg.screenshot(path=f'{OUT}/viewer_rot17.png')
        ok(19, '자유 각도(17°) 회전 후 도면 표시 클릭 선택', sel_title.startswith('LD-P1') and '17deg' in transform, f'stage {transform}, 회전 화면에서 클릭 → {sel_title.split()[0]}')

        # ---- 10. 모바일 QR 조회·사진 등록 + 20. 오프라인 저장·자동 전송 ----
        card = await (await pg.request.get(BASE + '/api/assets/3')).json()
        token = card['asset']['qr_token']
        m = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mp = await m.new_page()
        await mp.goto(f'{BASE}/q/{token}'); await mp.wait_for_timeout(800)
        on_login = '#/login' in mp.url
        await mp.fill('input[autocomplete=username]', 'demo_worker'); await mp.fill('input[type=password]', DEMO_PW)
        await mp.click('button[type=submit]'); await mp.wait_for_timeout(2000)
        landed = '#/m/asset/3' in mp.url
        before_files = len(card['files']); before_meas = len(card['measurements'])
        # 오프라인 전환 후 사진·측정 저장
        await m.set_offline(True)
        await mp.reload(); await mp.wait_for_timeout(2500)
        offline_banner = await mp.locator('.demo-flag').first.inner_text()
        await mp.click('button:has-text("사진 촬영·등록")')
        from PIL import Image
        img = Image.new('RGB', (320, 240), (90, 110, 130)); buf = io.BytesIO(); img.save(buf, 'JPEG')
        await mp.locator('input[type=file][capture]').first.set_input_files(files=[{'name': 'field.jpg', 'mimeType': 'image/jpeg', 'buffer': buf.getvalue()}])
        await mp.click('button.primary:has-text("저장")'); await mp.wait_for_timeout(1000)
        await mp.click('button:has-text("측정값 입력")')
        await mp.fill('input[name=combination]', 'L1-E'); await mp.fill('input[name=value]', '777')
        await mp.click('button.primary:has-text("저장")'); await mp.wait_for_timeout(1000)
        q_text = await mp.locator('.box:has-text("전송 대기")').first.inner_text()
        await mp.screenshot(path=f'{OUT}/mobile_offline.png')
        mid = await (await pg.request.get(BASE + '/api/assets/3')).json()
        not_yet = len(mid['files']) == before_files and len(mid['measurements']) == before_meas
        # 앱을 닫았다 다시 열어도 대기열 유지 → 온라인 복귀 시 자동 전송
        await mp.close(); mp = await m.new_page()
        await m.set_offline(False)
        await mp.goto(f'{BASE}/#/m/asset/3'); await mp.wait_for_timeout(5000)
        after = await (await pg.request.get(BASE + '/api/assets/3')).json()
        sent_photo = any(f['orig_name'] == 'field.jpg' for f in after['files'])
        sent_meas = any(x['value'] == 777 for x in after['measurements'])
        dup = sum(1 for x in after['measurements'] if x['value'] == 777)
        ok(10, 'QR 조회와 모바일 사진 등록', on_login and landed and sent_photo, f'비로그인 QR → 로그인 {on_login}, 로그인 후 카드 {landed}, 사진 서버 저장 {sent_photo}')
        ok(20, '모바일 오프라인 저장 → 앱 재실행 후 자동 전송 (중복 없음)', '오프라인' in offline_banner and '전송 대기 2건' in q_text and not_yet and sent_photo and sent_meas and dup == 1,
           f'오프라인 화면 "{offline_banner[:20]}…", 대기열 "{q_text.splitlines()[0]}", 오프라인 중 서버 미반영 {not_yet}, 재접속 후 사진 {sent_photo}·측정 {sent_meas}(중복 {dup}건)')

        print('PAGE ERRORS', errs)
        await b.close()
    json.dump(results, open(f'{OUT}/ui-results.json', 'w'), ensure_ascii=False, indent=2)

asyncio.run(main())
