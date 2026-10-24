"""TTA TTAK.KO-04.0082 PDF 의 '명칭 | 그림 기호 | 적요 | 영문표기 | 비고' 표에서 행별 (명칭, 그림기호 도형, 기호 안 문자, 영문표기) 추출."""
import re
import sys

import pymupdf

SECTION_DISC = [("3.2", "공통", "line"), ("3.3", "전기", "device"), ("3.4", "전기", "device"), ("3.5", "정보통신", "device")]


def extract(path, pages=range(11, 23)):
    d = pymupdf.open(path)
    out, section = [], None
    for pi in pages:
        pg = d[pi]
        words = pg.get_text("words")
        blocks = pg.get_text("dict")["blocks"]
        spans = [s for b in blocks if b.get("type") == 0 for L in b["lines"] for s in L["spans"] if s["text"].strip()]
        txt = pg.get_text()
        for m in re.finditer(r"3\.(\d)\.?(\d*)\.?\s*([^\n]+)", txt):
            section = f"3.{m.group(1)}"
        # 표 헤더 위치: '그림 기호' / '적' '요' / '영문표기'
        hdr = [s for s in spans if s["text"].replace(" ", "") in ("그림기호",)]
        if not hdr:
            continue
        hy = hdr[0]["bbox"][1]
        # 세로 격자선(표 칸 경계) 추출
        drs = pg.get_drawings()
        vx = sorted({round(it[1].x, 1) for dr in drs for it in dr["items"] if it[0] == "l" and abs(it[1].x - it[2].x) < 0.5 and abs(it[1].y - it[2].y) > 20})
        hl = sorted({round(it[1].y, 1) for dr in drs for it in dr["items"] if it[0] == "l" and abs(it[1].y - it[2].y) < 0.5 and abs(it[1].x - it[2].x) > 100})
        rects = [dr["rect"] for dr in drs]
        # 칸 경계 (rect 기반 표도 있음)
        for dr in drs:
            for it in dr["items"]:
                if it[0] == "re":
                    r = it[1]
                    if r.height > 20 and r.width < 2:
                        vx.append(round(r.x0, 1))
                    if r.width > 100 and r.height < 2:
                        hl.append(round(r.y0, 1))
        vx = sorted(set(vx)); hl = sorted(set(hl))
        hx = hdr[0]["bbox"]
        c1 = max([x for x in vx if x < hx[0] - 1], default=None)
        c2 = min([x for x in vx if x > hx[2] + 1], default=None)
        c0 = max([x for x in vx if x < (c1 or 0) - 5], default=None)
        if c1 is None or c2 is None or c0 is None:
            continue
        en_hdr = [s for s in spans if s["text"].replace(" ", "") == "영문표기"]
        ex0 = en_hdr[0]["bbox"][0] - 3 if en_hdr else None
        rows = [y for y in hl if y > hy + 5]
        top = min([y for y in hl if y > hy], default=hy + 15)
        bounds = sorted(set([top] + rows))
        for ra, rb in zip(bounds, bounds[1:]):
            if rb - ra < 8:
                continue
            name = " ".join(s["text"].strip() for s in spans if c0 <= s["bbox"][0] < c1 and ra < (s["bbox"][1] + s["bbox"][3]) / 2 < rb).strip()
            if not name:
                continue
            prims, letters = [], []
            for dr in drs:
                r = dr["rect"]
                if r.x0 >= c1 + 1 and r.x1 <= c2 - 1 and r.y0 >= ra + 0.5 and r.y1 <= rb - 0.5:
                    chain, curved = [], False
                    def flush():
                        nonlocal chain, curved
                        if len(chain) >= 2:
                            prims.append({"t": "a" if curved else "l", "p": chain})
                        chain, curved = [], False
                    for it in dr["items"]:
                        if it[0] in ("l", "c"):
                            a_ = (it[1].x, -it[1].y)
                            if chain and (abs(chain[-1][0] - a_[0]) > 0.05 or abs(chain[-1][1] - a_[1]) > 0.05):
                                flush()
                            if not chain:
                                chain.append(a_)
                            if it[0] == "l":
                                chain.append((it[2].x, -it[2].y))
                            else:
                                curved = True
                                p0, c1_, c2_, p3 = it[1], it[2], it[3], it[4]
                                for k in range(1, 7):
                                    t = k / 6
                                    x = (1-t)**3*p0.x + 3*(1-t)**2*t*c1_.x + 3*(1-t)*t*t*c2_.x + t**3*p3.x
                                    y = (1-t)**3*p0.y + 3*(1-t)**2*t*c1_.y + 3*(1-t)*t*t*c2_.y + t**3*p3.y
                                    chain.append((x, -y))
                        else:
                            flush()
                            if it[0] == "re":
                                r2 = it[1]
                                prims.append({"t": "l", "p": [(r2.x0, -r2.y0), (r2.x1, -r2.y0), (r2.x1, -r2.y1), (r2.x0, -r2.y1), (r2.x0, -r2.y0)]})
                            elif it[0] == "qu":
                                q = it[1]
                                prims.append({"t": "l", "p": [(q.ul.x, -q.ul.y), (q.ur.x, -q.ur.y), (q.lr.x, -q.lr.y), (q.ll.x, -q.ll.y), (q.ul.x, -q.ul.y)]})
                    flush()
                    if dr.get("fill") is not None and prims and prims[-1]["t"] != "f":
                        prims.append({"t": "f", "p": list(prims[-1]["p"])})   # 채움 기호(●) — 외곽선 + 채움
            for s in spans:
                if c1 <= s["bbox"][0] and s["bbox"][2] <= c2 and ra < s["bbox"][1] and s["bbox"][3] < rb:
                    letters.append(s["text"].strip())
            en = " ".join(s["text"].strip() for s in spans if ex0 and ex0 <= s["bbox"][0] < ex0 + 160 and ra < s["bbox"][1] < rb)
            out.append({"page": pi + 1, "section": section, "name": re.sub(r"\s+", " ", name), "prims": prims, "texts": letters, "en": en.strip()})
    return out


if __name__ == "__main__":
    rows = extract(sys.argv[1])
    for r in rows:
        print(r["page"], r["section"], r["name"], "| prims", len(r["prims"]), r["texts"], "|", r["en"][:40])
    print(len(rows))
