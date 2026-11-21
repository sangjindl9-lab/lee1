# uiautomator 덤프에서 text 또는 content-desc 로 노드 중심 좌표 찾기: python3 ui.py dump.xml "텍스트" [n번째(0부터)]
import sys, re, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(1)
key = sys.argv[2]; nth = int(sys.argv[3]) if len(sys.argv) > 3 else 0
hits = []
for n in root.iter('node'):
    for attr in ('text', 'content-desc'):
        v = n.get(attr) or ''
        if v == key or (len(key) > 3 and v.startswith(key)):
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds'))); hits.append(((x1 + x2) // 2, (y1 + y2) // 2)); break
if len(hits) > nth:
    print(*hits[nth]); sys.exit(0)
sys.exit(1)
