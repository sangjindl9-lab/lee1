"""UI 스모크 테스트: 실제 브라우저로 로그인 → 프로젝트 → 업로드 → 범례 인식 → 산출 → 화면 캡처."""
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8000"
FIX = Path(__file__).parent / "fixtures"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui")
OUT.mkdir(parents=True, exist_ok=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1500, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
        await pg.goto(BASE + "/#login")
        await pg.wait_for_selector("#r_comp")
        await pg.fill("#r_comp", "UI테스트전력"); await pg.fill("#r_name", "홍길동"); await pg.fill("#r_email", "ui@example.com"); await pg.fill("#r_pw", "password123")
        await pg.click("text=회사·관리자 등록")
        await pg.wait_for_selector("#p_name")
        await pg.screenshot(path=OUT / "01_projects.png")
        await pg.fill("#p_name", "[테스트] 공원 CCTV 설치공사"); await pg.fill("#p_client", "테스트시청")
        await pg.click("text=프로젝트 생성")
        await pg.wait_for_selector("a[href^='#project/']")
        await pg.click("a[href^='#project/']")
        await pg.wait_for_selector("#cv")
        await pg.set_input_files("input[type=file]", [str(FIX / "test_cctv_plan.dxf"), str(FIX / "test_cctv_riser.dxf")])
        for _ in range(60):
            await pg.wait_for_timeout(500)
            if await pg.locator("span.badge.done").count() >= 2:
                break
        await pg.click("text=C-01")
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUT / "02_upload_viewer.png")
        await pg.click("text=범례")
        await pg.click("text=범례표 자동 인식")
        await pg.wait_for_selector("text=고정형 네트워크 카메라", timeout=60000)
        await pg.click("text=품명 있는 항목 일괄 승인")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=OUT / "03_legend.png")
        await pg.click("text=자동 물량산출 실행")
        await pg.wait_for_selector(".jobbox", timeout=10000)
        await pg.wait_for_selector(".jobbox", state="detached", timeout=120000)
        await pg.wait_for_timeout(800)
        await pg.click("text=물량")
        await pg.wait_for_selector("text=통신용 전선관")
        await pg.click("text=통신용 전선관")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=OUT / "04_quantity.png")
        # 검출 기호 클릭 → 우측 패널
        await pg.click("text=고정형 네트워크 카메라")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT / "05_item_evidence.png")
        await pg.click("div.tabs >> text=검토")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT / "06_review.png")
        await pg.click("div.tabs >> text=적산")
        await pg.wait_for_selector("text=원가 계산")
        await pg.click("text=원가 계산")
        await pg.wait_for_selector("text=총공사비")
        await pg.screenshot(path=OUT / "07_estimate.png")
        items = await pg.evaluate("W.items.map(q=>[q.item_name,q.qty_total,q.status])")
        print("ITEMS", items)
        print("JS errors:", errors)
        await b.close()
        assert not errors, errors
        assert any(n == "통신용 전선관" and q == 45 for n, q, s in items)


asyncio.run(main())
