# 아이콘 PNG 만들기: public/icon.svg → 웹(192/512)·안드로이드 mipmap·스토어 아이콘
#   python3 scripts/gen-icons.py   (playwright 필요)
import asyncio, re, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent.parent
svg = (root / "public/icon.svg").read_text()
square_full = svg.replace('rx="112"', 'rx="0"')                      # 스토어용(구글이 모서리를 깎음)
round_svg = re.sub(r'<rect width="512" height="512" rx="112" fill="#1f3f8f"/>', '<circle cx="256" cy="256" r="256" fill="#1f3f8f"/>', svg)
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        async def shot(src, size, out):
            out.parent.mkdir(parents=True, exist_ok=True)
            await pg.set_viewport_size({"width": size, "height": size})
            await pg.set_content(f'<html><body style="margin:0;background:transparent">{src.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ")}</body></html>')
            await pg.screenshot(path=str(out), omit_background=True)
        res = root / "android/app/src/main/res"
        for d, s in SIZES.items():
            await shot(svg, s, res / f"mipmap-{d}/ic_launcher.png")
            await shot(round_svg, s, res / f"mipmap-{d}/ic_launcher_round.png")
        await shot(svg, 192, root / "public/icon-192.png")
        await shot(svg, 512, root / "public/icon-512.png")
        await shot(square_full, 512, root / "store/icon-512.png")
        await b.close()
asyncio.run(main())
