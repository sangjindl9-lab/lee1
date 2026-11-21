# uiautomator 덤프에서 text 또는 content-desc 로 노드 중심 좌표 찾기: python3 ui.py dump.xml "텍스트" [n번째(0부터)]
# 정확히 일치하는 노드를 먼저 찾고, 없을 때만 앞부분 일치를 쓴다.
import sys, re, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(1)
key = sys.argv[2]; nth = int(sys.argv[3]) if len(sys.argv) > 3 else 0
exact, prefix = [], []
for n in root.iter('node'):
    for attr in ('text', 'content-desc'):
        v = n.get(attr) or ''
        c = tuple((int(a) + int(b)) // 2 for a, b in [re.findall(r'\d+', n.get('bounds'))[i::2] for i in (0, 1)])
        if v == key: exact.append(c); break
        if len(key) > 3 and v.startswith(key): prefix.append(c); break
hits = exact or prefix
if len(hits) > nth:
    print(*hits[nth]); sys.exit(0)
sys.exit(1)
