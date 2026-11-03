"""샘플 도면 생성: 현장 배치 이미지(PNG, 20px = 1m), 관리동 평면 DXF(mm 단위)
실행: python3 scripts/make_sample_drawings.py  → samples/input/ 에 생성"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
import ezdxf

OUT = os.path.join(os.path.dirname(__file__), '..', 'samples', 'input')
os.makedirs(OUT, exist_ok=True)
FONT = os.path.join(os.path.dirname(__file__), '..', 'fonts', 'NotoSansKR-Regular.otf')

# 1) 현장 배치도 이미지 120m x 80m, 20px/m
S = 20
W, H = 120 * S, 80 * S
im = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(im)
f = ImageFont.truetype(FONT, 28); fs = ImageFont.truetype(FONT, 22)
def R(x0, y0, x1, y1, **k): d.rectangle([x0 * S, y0 * S, x1 * S, y1 * S], **k)
# 도로·주차장·건물
R(0, 70, 120, 80, fill='#e8e8e8'); d.text((50 * S, 73 * S), '진입도로', fill='#555', font=f)
R(10, 10, 50, 35, outline='black', width=4); d.text((22 * S, 20 * S), '관리동', fill='black', font=f)
R(65, 10, 110, 40, outline='black', width=4); d.text((80 * S, 22 * S), '창고동', fill='black', font=f)
R(10, 45, 60, 65, outline='#777', width=2); d.text((28 * S, 54 * S), '주차장', fill='#555', font=f)
for i in range(11): d.line([(10 + i * 5) * S, 45 * S, (10 + i * 5) * S, 50 * S], fill='#999', width=2)
R(70, 48, 110, 65, outline='#777', width=2); d.text((83 * S, 55 * S), '야적장', fill='#555', font=f)
d.rectangle([2, 2, W - 3, H - 3], outline='#2a6', width=6); d.text((3 * S, 3 * S), '부지 경계', fill='#2a6', font=fs)
# 축척 막대: (5m,77m) ~ (15m,77m) = 10m
d.line([5 * S, 77 * S, 15 * S, 77 * S], fill='black', width=5)
d.line([5 * S, 76 * S, 5 * S, 78 * S], fill='black', width=3); d.line([15 * S, 76 * S, 15 * S, 78 * S], fill='black', width=3)
d.text((7 * S, 74.3 * S), '10 m', fill='black', font=fs)
d.text((95 * S, 3 * S), 'N ↑', fill='black', font=f)
im.save(os.path.join(OUT, '현장배치도.png'))

# 2) 관리동 1층 평면 DXF (mm)
doc = ezdxf.new('R2013', setup=True)
doc.header['$INSUNITS'] = 4
msp = doc.modelspace()
doc.layers.add('A-WALL', color=7); doc.layers.add('A-DOOR', color=3); doc.layers.add('A-TEXT', color=2); doc.layers.add('A-GRID', color=8)
def rect(x0, y0, x1, y1, layer='A-WALL'): msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={'layer': layer})
rect(0, 0, 40000, 25000)
rect(200, 200, 39800, 24800)
for x in (10000, 20000, 30000): msp.add_line((x, 0), (x, 25000), dxfattribs={'layer': 'A-WALL'})
msp.add_line((0, 12500), (40000, 12500), dxfattribs={'layer': 'A-WALL'})
names = ['사무실', '회의실', '통신실', '전기실', '로비', '복도', '휴게실', '창고']
k = 0
for j, y in enumerate((18750, 6250)):
    for i, x in enumerate((5000, 15000, 25000, 35000)):
        msp.add_text(names[k], height=600, dxfattribs={'layer': 'A-TEXT'}).set_placement((x - 900, y))
        k += 1
for x in (5000, 15000, 25000, 35000):
    msp.add_arc((x, 12500), 900, 0, 90, dxfattribs={'layer': 'A-DOOR'})
for i, x in enumerate(range(0, 40001, 10000)):
    msp.add_circle((x, -2000), 600, dxfattribs={'layer': 'A-GRID'})
    msp.add_text(str(i + 1), height=500, dxfattribs={'layer': 'A-GRID'}).set_placement((x - 150, -2250))
msp.add_text('관리동 1층 평면도 (단위 mm)', height=800, dxfattribs={'layer': 'A-TEXT'}).set_placement((0, 26500))
doc.saveas(os.path.join(OUT, '관리동_1층.dxf'))
print('생성 완료:', os.listdir(OUT))
