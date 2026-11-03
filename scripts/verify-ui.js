#!/usr/bin/env node
/* 화면(UI) 검증: 실제 브라우저로 업로드 → 축척 보정 → 장비 배치 → 케이블 작성 → 저장 → 재접속 → 자동저장 실패 복구 → 출력 미리보기 → 계통도 → 모바일
 * 실행: BASE_URL=http://localhost:3000 node scripts/verify-ui.js  (Playwright 필요) */
const path = require('path');
const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }
const { Client } = require('./client');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'samples', 'output', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const IN = path.join(__dirname, '..', 'samples', 'input');
const res = []; const check = (ok, msg, d) => { res.push({ ok: !!ok, msg, d }); console.log(`${ok ? '✔' : '✘'} ${msg}${d != null ? ' — ' + JSON.stringify(d) : ''}`); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/401|409|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/');
  await p.fill('input[name=username]', process.env.ADMIN_USER || 'admin'); await p.fill('input[name=password]', process.env.ADMIN_PASSWORD || 'admin1234'); await p.click('button[type=submit]');
  await p.waitForSelector('#plistBody tr');
  // 새 프로젝트
  await p.click('#btnNewProject'); await p.fill('.modal input', 'UI 검증 프로젝트 ' + new Date().toISOString().slice(11, 19)); await p.click('.modal .mf button.primary');
  await p.waitForSelector('#toolbar button'); await p.waitForTimeout(500);
  // 업로드
  await p.click('#btnAddSheet'); const tmpPng = path.join(require('os').tmpdir(), 'cctv_site_plan.png'); fs.copyFileSync(path.join(IN, '현장배치도.png'), tmpPng); // Playwright 파일 선택은 한글 경로 미지원
  await p.setInputFiles('.modal input[type=file]', tmpPng);
  await p.waitForFunction(() => document.querySelector('.modal .mb') && /이미지 2400×1600/.test(document.querySelector('.modal .mb').innerText), null, { timeout: 30000 }).catch(async e => { await p.screenshot({ path: path.join(OUT, '_err.png') }); console.log(await p.evaluate(() => document.querySelector('.modal .mb') && document.querySelector('.modal .mb').innerText)); throw e; });
  await p.click('.modal .mf button.primary'); await p.waitForFunction(() => window.E && window.E.model && window.E.model.sheets.length === 1 && !document.querySelector('.modal-bg'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  check(await p.evaluate(() => !window.CCTVCalc.upmOf(window.E.model.sheets[0])), 'UI 업로드: 이미지 도면 등록, 축척 미설정 상태');
  await p.screenshot({ path: path.join(OUT, '01_업로드직후.png') });
  // 도면 좌표 → 화면 좌표
  const scr = async (x, y) => { const r = await p.evaluate(([x, y]) => { const rc = document.getElementById('svg').getBoundingClientRect(); const v = window.E.view; return [rc.left + v.tx + x * v.z, rc.top + v.ty + y * v.z]; }, [x, y]); return { x: r[0], y: r[1] }; };
  const click = async (x, y, opt) => { const s = await scr(x, y); await p.mouse.click(s.x, s.y, opt); await p.waitForTimeout(120); };
  // 축척 보정 도구: 10m 막대 (100,1540)-(300,1540)
  await p.click('#toolbar button:has-text("축척 보정")'); await click(100, 1540); await click(300, 1540);
  await p.waitForSelector('.modal input'); await p.fill('.modal input[type=number]', '10000'); await p.selectOption('.modal select', 'mm'); await p.click('.modal .mf button.primary'); await p.waitForTimeout(800);
  const upm = await p.evaluate(() => window.CCTVCalc.upmOf(window.E.model.sheets[0]));
  check(Math.abs(upm - 20) < 0.2, 'UI 두 점 축척 보정(10000mm 입력) → 1m = 20px', upm);
  // 장비 배치: PoE 스위치, IP 카메라
  await p.click('#library .it:has-text("PoE 스위치")'); await click(600, 600);
  await p.click('#library .it:has-text("IP 불릿형")'); await click(1000, 600);
  await p.click('#library .it:has-text("NVR")'); await click(600, 800);
  await p.keyboard.press('Escape');
  const devs = await p.evaluate(() => window.E.model.devices.map(d => d.tag));
  check(devs.length === 3, 'UI 장비 배치 3개', devs);
  // UTP 케이블: 스위치 → 경유점 → 카메라
  await p.click('#toolbar button:text-is("UTP")'); await click(600, 600); await click(800, 500); await click(1000, 600);
  await p.waitForTimeout(300);
  await p.click('#toolbar button:text-is("UTP")'); await click(600, 600); await click(600, 800);
  await p.keyboard.press('Escape');
  const cab = await p.evaluate(() => window.E.model.cables.map(c => ({ tag: c.tag, from: (window.E.model.devices.find(d => d.id === c.from.dev) || {}).tag, fp: c.from.port, to: (window.E.model.devices.find(d => d.id === c.to.dev) || {}).tag, tp: c.to.port, n: c.points.length })));
  check(cab.length === 2 && cab[0].from && cab[0].to && cab[0].n === 3, 'UI 케이블 작성: 장비 연결점·포트 자동 지정 + 경유점', cab);
  const L = await p.evaluate(() => { const c = window.E.model.cables[0]; return window.CCTVCalc.cableLength(c, window.CCTVCalc.index(window.E.model)); });
  const expect = (Math.hypot(200, 100) * 2) / 20; check(Math.abs(L.measured_m - expect) < 0.01, `케이블 측정 길이 ${L.measured_m.toFixed(2)}m (기대 ${expect.toFixed(2)}m)`);
  // 카메라 속성: NVR 지정 (속성 패널)
  await p.evaluate(() => { const E = window.E; const cam = E.model.devices.find(d => d.type === 'camera'); E.sel = new Set([cam.id]); }); await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await p.screenshot({ path: path.join(OUT, '02_배치_케이블.png') });
  // 저장
  await p.keyboard.press('Control+s'); await p.waitForFunction(() => document.getElementById('saveState').textContent === '저장됨', null, { timeout: 15000 });
  check(true, 'Ctrl+S 수동 저장 → 저장됨 표시');
  const pid = await p.evaluate(() => window.E.pid);
  // 재접속(새 브라우저 컨텍스트)
  const ctx2 = await b.newContext({ viewport: { width: 1600, height: 950 } }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/'); await p2.fill('input[name=username]', process.env.ADMIN_USER || 'admin'); await p2.fill('input[name=password]', process.env.ADMIN_PASSWORD || 'admin1234'); await p2.click('button[type=submit]'); await p2.waitForSelector('#plistBody tr');
  await p2.goto(BASE + '/#/p/' + pid); await p2.waitForFunction(() => window.E && window.E.model && window.E.model.cables.length === 2, null, { timeout: 15000 });
  const same = await p2.evaluate(() => window.E.model.cables.every(c => c.from.dev && c.to.dev));
  check(same, '새 세션(재접속)에서 장비·케이블·연결 유지');
  await ctx2.close();
  // 자동 저장 실패 → 복구
  await p.route('**/batch', r => r.abort());
  const camId = await p.evaluate(() => window.E.model.devices.find(d => d.type === 'camera').id);
  await p.evaluate(id => { const E = window.E; const d = E.model.devices.find(x => x.id === id); const before = JSON.parse(JSON.stringify(d)); const after = { ...before, x: before.x + 40 }; window.__ed.commit('이동', [{ e: 'devices', before, after }]); }, camId).catch(async () => { await p.evaluate(() => 0); });
  const hasEd = await p.evaluate(() => !!window.__ed);
  if (!hasEd) { const s = await scr(1000, 600); await p.click('#toolbar button:text-is("선택")'); await p.mouse.move(s.x, s.y); await p.mouse.down(); await p.mouse.move(s.x + 40, s.y + 10, { steps: 5 }); await p.mouse.up(); }
  await p.waitForSelector('.banner:has-text("자동 저장 실패")', { timeout: 15000 });
  const stash = await p.evaluate(id => localStorage.getItem('cctv-pending-' + id), pid);
  check(!!stash, '자동 저장 실패 안내 표시 + 변경 내용 브라우저 임시 보관');
  await p.screenshot({ path: path.join(OUT, '03_자동저장실패_안내.png') });
  await p.unroute('**/batch'); await p.click('.banner button:has-text("다시 시도")');
  await p.waitForFunction(() => document.getElementById('saveState').textContent === '저장됨', null, { timeout: 15000 });
  check(!(await p.evaluate(id => localStorage.getItem('cctv-pending-' + id), pid)), '다시 시도 → 저장 완료, 임시 보관 삭제');
  // ===== 추가 기능 화면 검증 =====
  await p.click('#toolbar button:text-is("선택")');
  // 포트 연결점 스냅: PSW-01의 P5를 직접 선택
  await p.click('#toolbar button:text-is("UTP")');
  const dotP5 = await p.evaluate(() => { const d = window.E.model.devices.find(x => x.tag === 'PSW-01'); return window.CCTVEditor.portDots(d, 'utp').find(q => q.id === 'P5'); });
  const sw = await scr(600, 600); await p.mouse.move(sw.x + 5, sw.y + 5); await p.waitForTimeout(100);
  const camPos = await p.evaluate(() => { const d = window.E.model.devices.find(x => x.type === 'camera'); return [d.x, d.y]; });
  await click(dotP5.x, dotP5.y); await click(camPos[0], camPos[1]); await p.keyboard.press('Escape');
  const pc = await p.evaluate(() => { const c = window.E.model.cables[window.E.model.cables.length - 1]; return c.from.port; });
  check(pc === 'P5', '포트 연결점 스냅: 장비 주변 포트(P5)를 직접 선택하여 연결', pc);
  // 교차 점프 기호: 교차하는 UTP 케이블 작성
  await p.click('#toolbar button:text-is("UTP")'); await click(700, 400); await click(700, 900); await p.keyboard.press('Enter'); await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const hops = await p.evaluate(() => document.querySelectorAll('#L_cables path[d*=" A "]').length);
  check(hops > 0, `케이블 교차(비접속) 점프 기호 표시 ${hops}개`);
  // 이동 시 연결 해제 옵션
  await p.click('#toolbar button:text-is("선택")');
  await p.click('#toolbar button:has-text("이동 시 연결 유지")');
  const nvr = await scr(600, 800); await p.mouse.move(nvr.x, nvr.y); await p.mouse.down(); await p.mouse.move(nvr.x + 60, nvr.y + 20, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
  const det = await p.evaluate(() => { const n = window.E.model.devices.find(x => x.tag === 'NVR-01'); return window.E.model.cables.filter(c => c.from.dev === n.id || c.to.dev === n.id).length; });
  check(det === 0, '이동 시 연결 해제 옵션: 장비만 이동, 케이블은 미연결로 남음');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
  const re = await p.evaluate(() => { const n = window.E.model.devices.find(x => x.tag === 'NVR-01'); return window.E.model.cables.filter(c => c.from.dev === n.id || c.to.dev === n.id).length; });
  check(re === 1, '실행 취소로 연결 복원'); await p.click('#toolbar button:has-text("이동 시 연결 해제")');
  // 관로 경로로 다시 그리기
  await p.click('#toolbar button:text-is("배관·트레이")'); await click(620, 640); await click(620, 700); await click(980, 700); await click(980, 640); await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  await p.evaluate(() => { const E = window.E; const cd = E.model.conduits[0]; const c = E.model.cables.find(x => x.tag === 'U-01'); window.CCTVEditor.update('cables', c, x => { x.conduit_ids = [cd.id]; }, '관로 할당'); E.sel = new Set([c.id]); });
  await p.click('#toolbar button:text-is("선택")'); await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await p.evaluate(() => { const E = window.E; const c = E.model.cables.find(x => x.tag === 'U-01'); E.sel = new Set([c.id]); }); await p.evaluate(() => document.querySelector('#svg').dispatchEvent(new Event('noop')));
  await p.keyboard.press('Escape'); await p.evaluate(() => { const E = window.E; const c = E.model.cables.find(x => x.tag === 'U-01'); E.sel = new Set([c.id]); });
  const s2 = await scr(800, 500); await p.mouse.click(s2.x, s2.y); await p.waitForTimeout(200);
  await p.click('#props button:has-text("관로 경로로 다시 그리기")'); await p.waitForTimeout(200);
  const rp = await p.evaluate(() => { const c = window.E.model.cables.find(x => x.tag === 'U-01'); return c.points.length; });
  check(rp >= 6, `관로 경로로 케이블 다시 그리기: 경로점 ${rp}개(관로 4점 + 양끝)`);
  // 사용자 정의 심볼
  await p.click('#library .it:has-text("+ 사용자 정의 심볼")'); await p.waitForSelector('.modal');
  await p.fill('.modal .form input >> nth=0', '경광등'); await p.fill('.modal .form input >> nth=1', 'WL'); await p.click('.modal .mf button.primary'); await p.waitForTimeout(400);
  await p.click('#library .it:has-text("경광등") span'); await click(1200, 900); await p.keyboard.press('Escape');
  const cs = await p.evaluate(() => window.E.model.devices.find(d => d.type === 'custom'));
  check(cs && cs.tag.startsWith('WL-') && cs.props.symbol_id, '사용자 정의 심볼 편집기로 만든 심볼 배치·자동 번호', cs && cs.tag);
  // 지도 좌표 연결 (도면 클릭 + 지도 클릭)
  await p.keyboard.press('Escape'); await p.evaluate(() => { window.E.sel.clear(); }); const e0 = await scr(50, 50); await p.mouse.click(e0.x, e0.y); await p.waitForTimeout(300);
  await p.click('#props button:has-text("지도 좌표 연결")'); await p.waitForSelector('.modal .leaflet-container', { timeout: 10000 });
  const mini = p.locator('.modal svg').first(); const mb = await mini.boundingBox(); const mapb = await p.locator('.modal .leaflet-container').boundingBox();
  await p.mouse.click(mb.x + 40, mb.y + 40); await p.mouse.click(mapb.x + 120, mapb.y + 120);
  await p.click('.modal button:has-text("+ 기준점 추가")'); await p.mouse.click(mb.x + mb.width - 40, mb.y + mb.height - 60); await p.mouse.click(mapb.x + 300, mapb.y + 220);
  await p.click('.modal .mf button.primary'); await p.waitForTimeout(500);
  const gr = await p.evaluate(() => (window.E.model.sheets[0].georef || {}).points);
  check(gr && gr.length === 2 && gr.every(q => q.lat && q.lng), '지도 좌표 연결: 도면·지도 클릭으로 기준점 2개 저장', gr && gr.map(q => [q.x, q.y, q.lat, q.lng]));
  await p.click('#toolbar button:text-is("지도")'); await p.waitForSelector('.modal .leaflet-container'); await p.waitForTimeout(800);
  const mk = await p.evaluate(() => document.querySelectorAll('.modal .leaflet-interactive').length);
  check(mk >= 4, `외부 지도 보기: 장비·케이블 ${mk}개 표시(타일은 관리자 설정 서버에서 로드)`);
  await p.screenshot({ path: path.join(OUT, '11_지도보기.png') }); await p.click('.modal .mh button');
  await p.keyboard.press('Control+s'); await p.waitForFunction(() => document.getElementById('saveState').textContent === '저장됨', null, { timeout: 15000 });
  // 출력 미리보기
  await p.click('#toolbar button:has-text("출력(PDF)")'); await p.waitForFunction(() => { const f = document.querySelector('.modal iframe'); return f && f.src && f.src.startsWith('blob:'); }, null, { timeout: 30000 });
  check(true, '출력 대화상자: 실제 PDF 미리보기 생성'); await p.waitForTimeout(1200); await p.screenshot({ path: path.join(OUT, '04_출력_미리보기.png') });
  await p.click('.modal .mh button'); await p.waitForTimeout(300);
  // 샘플 프로젝트 화면들
  const A = new Client(BASE); await A.login(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD || 'admin1234');
  const sp = (await A.get('/api/projects')).find(x => x.is_sample && !x.name.includes('(복원'));
  await p.goto(BASE + '/#/p/' + sp.id); await p.waitForFunction(id => window.E && window.E.pid === id && window.E.model, sp.id); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, '05_샘플_배치도.png') });
  // 회선 추적
  await p.evaluate(() => { const E = window.E; const c = E.model.devices.find(d => d.tag === 'ANC-01'); E.sel = new Set([c.id]); });
  await p.click('#toolbar button:has-text("회선 추적")'); await p.waitForTimeout(600);
  check(await p.locator('.modal:has-text("ANC-01 – 영상 회선")').count() > 0, '회선 추적: ANC-01 영상 회선(접속점·보호기 경유) 표시');
  await p.screenshot({ path: path.join(OUT, '06_회선추적.png') }); await p.click('.modal .mh button');
  // 하단 표: 검토 탭 / 물량 탭
  await p.click('#tabs .tab:has-text("물량산출")'); await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, '07_물량산출표.png') });
  await p.click('#tabs .tab:has-text("동축 회선")'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, '08_동축회선표.png') });
  // 스냅샷 도면 보기 + 준공도 출력
  await p.click('#toolbar button:has-text("개정·이력")'); await p.waitForSelector('.modal button:has-text("도면 보기")');
  await p.click('.modal button:has-text("도면 보기")'); await p.waitForSelector('.banner:has-text("스냅샷 보기")');
  const ro = await p.evaluate(() => document.getElementById('btnSave').disabled || !!window.E.snapView);
  check(ro, '개정 스냅샷 도면 보기(읽기 전용)'); await p.screenshot({ path: path.join(OUT, '12_스냅샷보기.png') });
  await p.click('.banner button:has-text("스냅샷 닫기")'); await p.waitForTimeout(800);
  check(await p.evaluate(() => !window.E.snapView), '스냅샷 닫기 → 현재 설계로 복귀');
  await p.evaluate(() => window.E.sel.clear()); await p.keyboard.press('Escape');
  await p.click('#props button:has-text("준공도 출력")'); await p.waitForFunction(() => { const f = document.querySelector('.modal iframe'); return f && f.src && f.src.startsWith('blob:'); }, null, { timeout: 30000 });
  check(true, '준공도 출력 미리보기 생성'); await p.waitForTimeout(1000); await p.screenshot({ path: path.join(OUT, '13_준공도_미리보기.png') }); await p.click('.modal .mh button');
  // 계통도
  await p.click('#toolbar button:has-text("계통도")'); await p.waitForTimeout(1200); await p.screenshot({ path: path.join(OUT, '09_계통도.png') });
  check(await p.evaluate(() => document.querySelectorAll('#svg [data-node]').length) > 15, '계통도 화면: 배치도 데이터로 노드 생성');
  // 모바일 현장 화면
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage();
  await mp.goto(BASE + '/m.html'); await mp.fill('input.msearch', process.env.ADMIN_USER || 'admin'); await mp.fill('input[type=password]', process.env.ADMIN_PASSWORD || 'admin1234'); await mp.click('button.primary');
  await mp.waitForSelector('.card.click'); const M0 = await A.get(`/api/projects/${sp.id}/model`); const dv = M0.devices.find(d => d.tag === 'ANC-03');
  await mp.goto(`${BASE}/m.html#p=${sp.id}&s=${dv.sheet_id}&d=${dv.id}`); await mp.waitForSelector('text=현장 확인'); await mp.waitForTimeout(1000);
  await mp.screenshot({ path: path.join(OUT, '10_모바일_장비상세.png'), fullPage: true });
  check(await mp.locator('select').count() > 0, '모바일: QR 링크(장비 상세) 열기·현장 확인 화면');
  await m.close();
  check(!errs.length, '브라우저 스크립트 오류 없음', errs.slice(0, 5));
  await b.close();
  const file = path.join(__dirname, '..', 'samples', 'output', 'test-results-ui.json'); fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), results: res }, null, 1));
  console.log(`UI 검사 ${res.length}개, 실패 ${res.filter(r => !r.ok).length}개`);
  process.exit(res.some(r => !r.ok) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
