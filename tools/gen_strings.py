"""strings_data.py → app/src/main/res/values*/strings.xml (기본 = 한국어)"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from strings_data import S
root = os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'main', 'res')
def esc(s):
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace("'", "\\'").replace('"', '\\"').replace('\n', '\\n')
    return s
for i, d in enumerate(['values', 'values-en', 'values-ja', 'values-zh-rCN', 'values-es']):
    os.makedirs(os.path.join(root, d), exist_ok=True)
    with open(os.path.join(root, d, 'strings.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        for row in S:
            if d != 'values' and row[0] == 'app_name': continue
            f.write(f'    <string name="{row[0]}">{esc(row[i + 1])}</string>\n')
        f.write('</resources>\n')
# Play 판 덮어쓰기 문구 → app/src/play/res
from strings_play import S as P
proot = os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'play', 'res')
for i, d in enumerate(['values', 'values-en', 'values-ja', 'values-zh-rCN', 'values-es']):
    os.makedirs(os.path.join(proot, d), exist_ok=True)
    with open(os.path.join(proot, d, 'strings.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        for row in P: f.write(f'    <string name="{row[0]}">{esc(row[i + 1])}</string>\n')
        f.write('</resources>\n')
keys = [r[0] for r in S]; assert len(keys) == len(set(keys)), 'dup'
assert all(len(r) == 6 for r in S)
print(len(S), 'strings')
