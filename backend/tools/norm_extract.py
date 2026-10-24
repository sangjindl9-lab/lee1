"""표준품셈 PDF → 품 항목(JSON) 추출.

표 머리글에 직종명(내선전공, 통신설비공 …)이 있는 표만 대상으로, 각 숫자 줄을
  [절 번호·제목] + [공종·규격 등 왼쪽 칸 글자] + [단위] + {직종: 인공}
으로 만든다. 한 칸에 규격 여러 줄이 들어간 표(정보통신 품셈)는 글자 위치(y)로 줄을 맞춘다.
직종이 행으로 놓인 표(머리글 '직종/공종', '구분/공종')는 전치해서 같은 방식으로 처리한다.

사용: python tools/norm_extract.py <pdf> <접두어 E|T> <출처명> <out.json>
"""
from __future__ import annotations

import json
import re
import sys

import pymupdf

TRADES = {
    "보통인부", "특별인부", "내선전공", "변전전공", "전철전공", "배전전공", "S/W시험사", "H/W시험사", "전기공사기사",
    "기계설비공", "송전전공", "배전활선전공", "특고압케이블전공", "전기공사산업기사", "비계공", "도장공", "인력운반공",
    "저압케이블전공", "플랜트전공", "계장공", "케이블전공", "광케이블설치사", "용접공", "석공", "송전활선전공", "용접공(일반)",
    "형틀목공", "내장공", "건축목공", "무선안테나공", "콘크리트공", "고압케이블전공", "방수공", "작업반장", "통신설비공",
    "통신관련산업기사", "통신케이블공", "통신관련기능사", "통신관련기사", "통신외선공", "통신내선공", "철공", "플랜트기계설치공",
    "지적기사", "통신외선공(송전전공)", "철근공", "배관공", "덕트공", "보온공", "전공",
}
ALIAS = {"통신외선공(송전전공)": "통신외선공", "용접공(일반)": "용접공"}
NUM = re.compile(r"^-?\d{1,4}(?:,\d{3})*(?:\.\d+)?$")
SEC = re.compile(r"^\s*(\d{1,2}-\d{1,3}(?:-\d{1,3}){0,3})\s*(?:\(\s*`?\d{2}년\s*\S*\))?\s*([^\d·…].{1,70}?)\s*(?:\((?:`|')?\d{2}년[^)]*\))?\s*$")
UNIT_RE = re.compile(r"\(\s*단\s*위\s*[:：]\s*([^)]+)\)")
PERUNIT = re.compile(r"\(([^()]{1,8})당\)")


def norm(s: str | None) -> str:
    return re.sub(r"\s+", "", s or "")


def tidy(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


SPEC_START = re.compile(r"(?=[Ø∅φΦ\d])")


def clean_label(label: str, values) -> str:
    """라벨 정리: 값 숫자 제거, 세로쓰기 한 글자들 붙이기, 반복 구절 제거"""
    vals = {f"{v:g}" for v in values} | {f"{v:.2f}" for v in values} | {f"{v:.3f}" for v in values}
    toks = [t for t in label.replace("〃", " ").split() if not (NUM.match(t) and (t in vals or t.replace(",", "") in vals))]
    out, buf = [], []
    for t in toks:                       # '개 별 설 치' → '개별설치'
        if len(t) == 1 and re.match(r"[가-힣]", t):
            buf.append(t)
            continue
        if buf:
            out.append("".join(buf)); buf = []
        out.append(t)
    if buf:
        out.append("".join(buf))
    # 연속 중복 단어·구절 제거
    res = []
    for t in out:
        if res and res[-1] == t:
            continue
        res.append(t)
    n = len(res)
    for k in range(n // 2, 0, -1):       # 'A B A B' → 'A B'
        if res[n - 2 * k:n - k] == res[n - k:]:
            res = res[:n - k]
            break
    return " ".join(res)


def page_sections(page) -> list[tuple[float, str, str]]:
    """페이지 안 절 제목 [(y, 번호, 제목)]"""
    out = []
    for b in page.get_text("dict")["blocks"]:
        for L in b.get("lines", []):
            txt = "".join(s["text"] for s in L["spans"]).strip()
            m = SEC.match(txt)
            if m and not txt.endswith("·") and len(txt) < 80 and "…" not in txt and "··" not in txt:
                out.append((L["bbox"][1], m.group(1), m.group(2).strip()))
    return out


def page_units(page) -> list[tuple[float, str]]:
    out = []
    for b in page.get_text("dict")["blocks"]:
        for L in b.get("lines", []):
            txt = "".join(s["text"] for s in L["spans"])
            m = UNIT_RE.search(txt)
            if m:
                out.append((L["bbox"][1], norm(m.group(1))))
    return out


def cell_text(page, c) -> str:
    return page.get_textbox(c) if c else ""


def extract_table(page, t, words):
    rows = t.rows
    if len(rows) < 2:
        return []
    hdr_cells = rows[0].cells
    hdr = [norm(cell_text(page, c)) for c in hdr_cells]
    trade_cols = [i for i, h in enumerate(hdr) if h in TRADES]
    if not trade_cols and len(rows) >= 3:
        # 두 줄 머리글: 1행 = 종류(합성수지 전선관 …), 2행 = '호칭 | 내선전공' 짝 → 열 쌍별로 품 생성
        hdr2 = [norm(cell_text(page, c)) for c in rows[1].cells]
        tc2 = [i for i, h in enumerate(hdr2) if h in TRADES]
        if tc2:
            return two_row_table(page, t, rows, hdr2, tc2)
    transposed = False
    if not trade_cols:
        # 직종이 행에 있는 표: 첫 열에 직종명이 2개 이상
        first = [norm(cell_text(page, r.cells[0])) if r.cells and r.cells[0] else "" for r in rows[1:]]
        if sum(1 for x in first if x in TRADES) >= 1 and len(hdr) >= 2:
            transposed = True
        else:
            return []
    out = []
    if transposed:
        specs = [(i, tidy(cell_text(page, c))) for i, c in enumerate(hdr_cells) if i > 0 and c]
        for i, label in specs:
            label = clean_label(label, [])
            if not label or label in ("단위", "비고"):
                continue
            labor = {}
            for r in rows[1:]:
                if not r.cells or not r.cells[0] or i >= len(r.cells) or not r.cells[i]:
                    continue
                trade = norm(cell_text(page, r.cells[0]))
                if trade not in TRADES:
                    continue
                v = norm(cell_text(page, r.cells[i]))
                if NUM.match(v) and float(v.replace(",", "")) > 0:
                    labor[ALIAS.get(trade, trade)] = float(v.replace(",", ""))
            if labor:
                out.append({"label": label, "unit": None, "labor": labor, "y": t.bbox[1]})
        return out

    unit_col = next((i for i, h in enumerate(hdr) if h.startswith("단위")), None)
    label_cols = [i for i in range(len(hdr)) if i not in trade_cols and i != unit_col and not hdr[i].startswith("비고")
                  and "장비" not in hdr[i] and "시간" not in hdr[i]]
    # 열 x 범위 (머리글 칸 기준, 병합 머리글이면 다음 행 칸으로 보완)
    def col_x(i):
        for r in rows:
            if i < len(r.cells) and r.cells[i]:
                return r.cells[i][0], r.cells[i][2]
        return None
    xr = {i: col_x(i) for i in range(len(hdr))}
    hy1 = max(c[3] for c in hdr_cells if c)
    body = [w for w in words if w[1] >= hy1 - 1 and w[3] <= t.bbox[3] + 1 and w[0] >= t.bbox[0] - 1 and w[2] <= t.bbox[2] + 1]
    # 줄 묶기
    body.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    lines, cur = [], []
    for w in body:
        yc = (w[1] + w[3]) / 2
        if cur and abs(yc - cur[-1][-1]) > 3.0:
            lines.append(cur)
            cur = []
        cur.append((*w[:5], yc))
    if cur:
        lines.append(cur)

    def in_col(w, i):
        x = xr.get(i)
        if not x:
            return False
        xc = (w[0] + w[2]) / 2
        return x[0] - 1 <= xc <= x[1] + 1

    # 왼쪽 칸(병합 칸 포함)의 셀 영역과 글자
    label_cells = {i: [] for i in label_cols}
    for r in rows[1:]:
        for i in label_cols:
            if i < len(r.cells) and r.cells[i]:
                c = r.cells[i]
                label_cells[i].append((c, tidy(cell_text(page, c))))
    last = {i: "" for i in label_cols}
    for ln in lines:
        vals = {}
        for i in trade_cols:
            toks = [w[4] for w in ln if in_col(w, i)]
            tok = norm("".join(toks))
            if NUM.match(tok):
                v = float(tok.replace(",", ""))
                if v > 0:
                    vals[ALIAS.get(hdr[i], hdr[i])] = v
        if not vals:
            continue
        yc = ln[0][-1]
        parts = []
        for i in label_cols:
            here = tidy(" ".join(w[4] for w in ln if in_col(w, i)))
            if here:
                if here.startswith("〃") or here == "〃":
                    # '〃' = 위와 같음 → 윗줄의 품명 부분(규격 앞까지) + 이 줄 규격
                    base = SPEC_START.split(last[i], 1)[0].strip() if last[i] else ""
                    here = (base + " " + here.replace("〃", "").strip()).strip() or last[i]
                else:
                    last[i] = here
                parts.append(here)
                continue
            # 이 줄에 글자가 없으면: 이 y 를 포함하는 (병합) 칸 글자 중 첫 줄
            cell = next((txt for c, txt in label_cells[i] if c[1] - 1 <= yc <= c[3] + 1), "")
            if cell:
                parts.append(cell.split(" ")[0] if len(cell) > 40 else cell)
            elif last[i]:
                parts.append(last[i])
        unit = None
        if unit_col is not None:
            unit = tidy(" ".join(w[4] for w in ln if in_col(w, unit_col))) or None
            if not unit:
                unit = next((tidy(cell_text(page, r.cells[unit_col])) for r in rows[1:] if unit_col < len(r.cells) and r.cells[unit_col]
                             and r.cells[unit_col][1] - 1 <= yc <= r.cells[unit_col][3] + 1), None)
        label = clean_label(" ".join(p for p in parts if p), vals.values())
        out.append({"label": label[:160], "unit": unit, "labor": vals, "y": yc})
    return out



def two_row_table(page, t, rows, hdr2, tc2):
    out = []
    top = rows[0].cells

    def group_of(j):
        for k in range(j, -1, -1):
            if k < len(top) and top[k]:
                return tidy(cell_text(page, top[k]))
        return ""
    # 같은 종류(group) 안에서 '규격/호칭' 열과 직종 열들을 묶는다
    for r in rows[2:]:
        cells = r.cells
        by_group: dict[str, dict] = {}
        for j in tc2:
            if j >= len(cells) or not cells[j]:
                continue
            v = norm(cell_text(page, cells[j]))
            if not NUM.match(v) or float(v.replace(",", "")) <= 0:
                continue
            k = j - 1
            while k >= 0 and hdr2[k] in TRADES:
                k -= 1
            spec = tidy(cell_text(page, cells[k])) if k >= 0 and k < len(cells) and cells[k] else ""
            if spec in ("-", ""):
                continue
            g = group_of(k if k >= 0 else j)
            key = g + "|" + spec
            d = by_group.setdefault(key, {"label": f"{g} {spec}".strip(), "labor": {}})
            d["labor"][ALIAS.get(hdr2[j], hdr2[j])] = float(v.replace(",", ""))
        for d in by_group.values():
            out.append({"label": clean_label(d["label"], d["labor"].values()), "unit": None, "labor": d["labor"], "y": cells[0][1] if cells and cells[0] else t.bbox[1]})
    return out

def extract(path: str, prefix: str, source: str) -> list[dict]:
    d = pymupdf.open(path)
    sec_no, sec_title, items = None, None, []
    for pi in range(len(d)):
        page = d[pi]
        secs = page_sections(page)
        units = page_units(page)
        try:
            tables = page.find_tables().tables
        except Exception:
            tables = []
        words = page.get_text("words")
        for t in sorted(tables, key=lambda t: t.bbox[1]):
            top = t.bbox[1]
            above = [s for s in secs if s[0] < top]
            if above:
                sec_no, sec_title = above[-1][1], above[-1][2]
            unit_hint = None
            u_above = [u for u in units if top - 60 < u[0] < top + 5] or [u for u in units if t.bbox[3] - 2 < u[0] < t.bbox[3] + 30]
            if u_above:
                unit_hint = u_above[-1][1]
            elif sec_title:
                m = PERUNIT.search(sec_title)
                if m:
                    unit_hint = m.group(1)
            try:
                rows = extract_table(page, t, words)
            except Exception:
                continue
            for k, r in enumerate(rows):
                items.append({"code": f"{prefix}{sec_no or 'p' + str(pi + 1)}#{len([i for i in items if i['section'] == sec_no]) + 1}",
                              "section": sec_no, "section_title": sec_title,
                              "title": f"{sec_title or ''} {r['label']}".strip(), "unit": r["unit"] or unit_hint or "식",
                              "labor": r["labor"], "page": pi + 1, "source": source})
        # 다음 페이지로 절 제목 이어 가기
        if secs:
            sec_no, sec_title = secs[-1][1], secs[-1][2]
    return items


if __name__ == "__main__":
    path, prefix, source, out = sys.argv[1:5]
    items = extract(path, prefix, source)
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(items, fp, ensure_ascii=False)
    print(len(items), "items →", out)
