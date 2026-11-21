# 접근성 점검(자동): 누를 수 있는 요소의 크기(48dp)와 이름(글자/설명) 유무. python3 a11y.py dump.xml density 이름
import sys, re, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot(); dens = int(sys.argv[2]) / 160.0; name = sys.argv[3]
small, unnamed, total = [], [], 0
def label(n):
    t = (n.get('text') or '') + (n.get('content-desc') or '')
    for c in n.iter('node'): t += (c.get('text') or '') + (c.get('content-desc') or '')
    return t.strip()
for n in root.iter('node'):
    if n.get('clickable') != 'true' or n.get('package') != 'kr.eumsoft.purchasenote': continue
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds'))); total += 1
    w, h = (x2 - x1) / dens, (y2 - y1) / dens
    lab = label(n)
    if (w < 47.5 or h < 47.5) and y2 > y1: small.append(f"{lab[:30]!r} {w:.0f}x{h:.0f}dp")
    if not lab: unnamed.append(n.get('bounds'))
print(f"[{name}] 누를 수 있는 요소 {total}개 / 48dp 미만 {len(small)} / 이름 없음 {len(unnamed)}")
for s in small[:10]: print("   작음:", s)
for s in unnamed[:10]: print("   이름 없음:", s)
