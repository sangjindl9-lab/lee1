# uiautomator 덤프에서 text/content-desc로 노드 중심 좌표 찾기: python3 ui.py dump.xml "텍스트" [desc]
import sys, re, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(1)
key = sys.argv[2]; attr = 'content-desc' if len(sys.argv) > 3 else 'text'
for n in root.iter('node'):
    v = n.get(attr) or ''
    if v == key or (len(key) > 3 and v.startswith(key)):
        m = re.findall(r'\d+', n.get('bounds'))
        x1, y1, x2, y2 = map(int, m)
        print((x1 + x2) // 2, (y1 + y2) // 2); sys.exit(0)
sys.exit(1)
