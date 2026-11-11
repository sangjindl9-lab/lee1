# uiautomator 덤프 도우미
#   ui.py dump.xml find "글자" [exact]  -> 가장 작은 일치 노드의 중심 좌표 "x y"
#   ui.py dump.xml bounds "글자"        -> "x1 y1 x2 y2"
#   ui.py dump.xml has "글자"           -> 있으면 종료코드 0
#   ui.py dump.xml gate                 -> 부모님 확인 문제의 정답
import sys, re, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(2)
cmd = sys.argv[2]
if cmd == 'gate':
    for n in root.iter('node'):
        m = re.search(r'(\d+) × (\d+) =', n.get('text') or '')
        if m:
            print(int(m.group(1)) * int(m.group(2))); sys.exit(0)
    sys.exit(1)
key = sys.argv[3]; exact = len(sys.argv) > 4
best = None
for n in root.iter('node'):
    for attr in ('content-desc', 'text'):
        v = n.get(attr) or ''
        if (v == key) if exact else (key in v):
            x1, y1, x2, y2 = map(int, re.findall(r'-?\d+', n.get('bounds')))
            area = (x2 - x1) * (y2 - y1)
            if area > 0 and (best is None or area < best[0]): best = (area, x1, y1, x2, y2)
if best is None: sys.exit(1)
_, x1, y1, x2, y2 = best
if cmd == 'find': print((x1 + x2) // 2, (y1 + y2) // 2)
elif cmd == 'bounds': print(x1, y1, x2, y2)
