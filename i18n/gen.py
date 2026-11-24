# i18n/tr.txt + 소스의 L.t/L.f 키 → src/kr/allzip/core/L.java
import re, glob, sys
LANGS = ['en','ja','de','fr','es','it','pt','nl','pl','hi']
keys = []
for fn in sorted(glob.glob('src/kr/allzip/**/*.java', recursive=True)):
    if fn.endswith('/L.java'): continue
    for m in re.finditer(r'L\.[tf]\("((?:[^"\\]|\\.)*)"', open(fn, encoding='utf-8').read()):
        if m.group(1) not in keys: keys.append(m.group(1))
rows = [l.rstrip('\n') for l in open('i18n/tr.txt', encoding='utf-8') if not l.startswith('#')]
if len(rows) != len(keys): sys.exit('rows %d != keys %d' % (len(rows), len(keys)))
def jesc(s): return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
cols = {l: [] for l in LANGS}
for k, r in zip(keys, rows):
    v = r.split(' ‖ ')
    if len(v) != len(LANGS): sys.exit('bad row: ' + r)
    kr = k.replace('\\n', '\n')
    for l, x in zip(LANGS, v):
        x = x.replace('\\n', '\n')
        if kr.endswith(' ') and not x.endswith(' '): x += ' '
        if kr.count('%s') != x.count('%s'): sys.exit('%%s mismatch %s: %s' % (l, x))
        cols[l].append(jesc(x))
out = ['package kr.allzip.core;', '', 'import java.util.HashMap;', 'import java.util.Locale;', '',
       '/** 화면 문구 번역. 한국어 원문이 키. i18n/gen.py 가 만든 파일 — 직접 고치지 말고 i18n/tr.txt 를 고친 뒤 다시 생성. */',
       'public final class L {', '    private static final String LANG = Locale.getDefault().getLanguage();',
       '    private static final HashMap<String, String> M = new HashMap<String, String>();',
       '    public static boolean ko() { return "ko".equals(LANG); }',
       '    public static String t(String ko) { String v = M.get(ko); return v == null ? ko : v; }',
       '    public static String f(String ko, Object... a) { return String.format(t(ko), a); }',
       '    private static final String[] K = {']
out += ['        "%s",' % k for k in keys] + ['    };']
for l in LANGS:
    out.append('    private static String[] %s() { return new String[]{' % l.upper())
    out += ['        "%s",' % x for x in cols[l]] + ['    }; }']
out += ['    static {', '        String[] v = null;']
out += ['        if ("%s".equals(LANG)) v = %s();' % (l, l.upper()) for l in LANGS]
out += ['        if (v == null && !"ko".equals(LANG)) v = EN();', '        if (v != null) for (int i = 0; i < K.length; i++) M.put(K[i], v[i]);', '    }', '    private L() {}', '}', '']
open('src/kr/allzip/core/L.java', 'w', encoding='utf-8').write('\n'.join(out))
print('ok', len(keys), 'keys x', len(LANGS))
