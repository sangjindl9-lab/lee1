"""테스트·데모용 샘플 CAD 파일 생성 (cadquery, ezdxf 필요)
python3 scripts/make_samples.py  →  samples/*.step, *.stl, *.dxf
"""
import os, cadquery as cq, ezdxf
OUT = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(OUT, exist_ok=True)
C = cq.Color

# ── 1) 방수 제어함 조립체 (기계·전기 공통 시연용) ─────────────────
W, D, H, T = 160, 160, 120, 4
body = (cq.Workplane("XY").box(W, D, H).edges("|Z").fillet(8).faces(">Z").shell(-T)
        .faces("<Z").workplane().rect(W - 30, D - 30).cutThruAll())
lid = cq.Workplane("XY").box(W + 6, D + 6, 8).edges("|Z").fillet(10).faces(">Z").edges().chamfer(1.5)
for x in (-1, 1):
    for y in (-1, 1):
        lid = lid.faces(">Z").workplane().center(0, 0).pushPoints([(x * (W / 2 - 6), y * (D / 2 - 6))]).hole(5)
base = cq.Workplane("XY").box(W + 30, D + 6, 6).faces(">Z").workplane().pushPoints(
    [(x * (W / 2 + 8), y * 50) for x in (-1, 1) for y in (-1, 1)]).hole(7)
gasket = cq.Workplane("XY").rect(W - 4, D - 4).extrude(2).cut(cq.Workplane("XY").rect(W - 12, D - 12).extrude(2))
front = cq.Workplane("YZ").box(D, H, 8).faces(">X").workplane().pushPoints([(-35, -20), (35, -20)]).hole(22)
gland = cq.Workplane("YZ").circle(14).polygon(6, 30).extrude(10).faces(">X").workplane().circle(13).extrude(14).faces(">X").hole(9)
sink = cq.Workplane("YZ").box(D, H, 6)
for i in range(-6, 7):
    sink = sink.union(cq.Workplane("YZ").center(i * 11, 0).box(3, H - 10, 24).translate((15, 0, 0)))
plate = cq.Workplane("YZ").box(D - 30, H - 30, 2).faces(">X").workplane().rarray(25, 25, 4, 3).hole(3)
pcb = cq.Workplane("XY").box(100, 80, 1.6)
chip = cq.Workplane("XY").box(20, 20, 3)
cap = cq.Workplane("XY").circle(4).extrude(10)
bolt = cq.Workplane("XY").polygon(6, 9).extrude(4).faces("<Z").workplane().circle(2.5).extrude(18)

enc = cq.Assembly(name="방수제어함_ASSY")
enc.add(body, name="본체_케이스", color=C(0.32, 0.34, 0.37), loc=cq.Location((0, 0, H / 2)))
enc.add(lid, name="상부_커버", color=C(0.55, 0.57, 0.6), loc=cq.Location((0, 0, H + 4)))
enc.add(gasket, name="상부_가스켓", color=C(0.95, 0.42, 0.1), loc=cq.Location((0, 0, H - 2)))
enc.add(base, name="하부_베이스", color=C(0.35, 0.36, 0.38), loc=cq.Location((0, 0, -3)))
enc.add(front, name="전면_패널", color=C(0.3, 0.31, 0.33), loc=cq.Location((-W / 2 - 4, 0, H / 2)))
for i, y in enumerate((-35, 35)):
    enc.add(gland, name=f"케이블_글랜드_{i+1}", color=C(0.12, 0.12, 0.13),
            loc=cq.Location((-W / 2 - 18, y, H / 2 - 20)))
enc.add(sink, name="후면_방열판", color=C(0.22, 0.23, 0.25), loc=cq.Location((W / 2 + 3, 0, H / 2)))
enc.add(plate, name="내부_마운팅플레이트", color=C(0.75, 0.76, 0.78), loc=cq.Location((-W / 2 + 12, 0, H / 2)))
enc.add(pcb, name="제어보드_PCB", color=C(0.05, 0.45, 0.2), loc=cq.Location((10, 0, 30)))
enc.add(chip, name="CPU_모듈", color=C(0.1, 0.1, 0.1), loc=cq.Location((10, 0, 32.3)))
for i, (x, y) in enumerate(((40, 25), (40, -25), (-20, 25))):
    enc.add(cap, name=f"콘덴서_{i+1}", color=C(0.1, 0.2, 0.6), loc=cq.Location((x, y, 30.8)))
for i, (x, y) in enumerate([(sx * (W / 2 - 6), sy * (D / 2 - 6)) for sx in (-1, 1) for sy in (-1, 1)]):
    enc.add(bolt, name=f"커버_볼트_M5_{i+1}", color=C(0.8, 0.8, 0.82),
            loc=cq.Location((x, y, H + 26), (1, 0, 0), 180))
enc.export(os.path.join(OUT, "enclosure_assembly.step"))

# ── 2) 2단 사출금형 조립체 ───────────────────────────────────────
MW, MD = 200, 180
def pl(t): return cq.Workplane("XY").box(MW, MD, t)
z = 0
mold = cq.Assembly(name="사출금형_2단_ASSY")
def add(shape, name, t, col):
    global z
    mold.add(shape, name=name, color=col, loc=cq.Location((0, 0, z + t / 2))); z += t
lower = pl(25)
add(lower, "하측_고정판", 25, C(0.3, 0.32, 0.36))
rail = cq.Workplane("XY").box(30, MD, 60)
mold.add(rail, name="스페이서블록_좌", color=C(0.4, 0.42, 0.45), loc=cq.Location((-MW / 2 + 15, 0, z + 30)))
mold.add(rail, name="스페이서블록_우", color=C(0.4, 0.42, 0.45), loc=cq.Location((MW / 2 - 15, 0, z + 30)))
ejp = cq.Workplane("XY").box(MW - 70, MD - 20, 15)
mold.add(ejp, name="이젝터_플레이트", color=C(0.7, 0.55, 0.15), loc=cq.Location((0, 0, z + 12)))
pin_pts = [(-30, -30), (30, -30), (-30, 30), (30, 30)]
for i, (x, y) in enumerate(pin_pts):
    mold.add(cq.Workplane("XY").circle(3).extrude(100), name=f"이젝터_핀_{i+1}", color=C(0.85, 0.85, 0.88),
             loc=cq.Location((x, y, z + 19)))
z += 60
core = pl(40).faces(">Z").workplane().rect(90, 70).extrude(15).faces(">Z").edges().fillet(3)
core = core.faces("<Z").workplane().pushPoints(pin_pts).hole(6.4)
mold.add(core, name="가동측_형판_코어", color=C(0.62, 0.65, 0.7), loc=cq.Location((0, 0, z + 20)))
z += 40
cav = pl(45).faces("<Z").workplane().rect(100, 80).cutBlind(-20)
cav = cav.faces(">Z").workplane().hole(8)
mold.add(cav, name="고정측_형판_캐비티", color=C(0.45, 0.6, 0.78), loc=cq.Location((0, 0, z + 22.5)))
for i, (x, y) in enumerate([(-80, -70), (80, -70), (-80, 70), (80, 70)]):
    mold.add(cq.Workplane("XY").circle(8).extrude(90), name=f"가이드_핀_{i+1}", color=C(0.9, 0.9, 0.92),
             loc=cq.Location((x, y, z - 40)))
part = cq.Workplane("XY").rect(88, 68).extrude(2).faces(">Z").rect(88, 68).extrude(13).faces(">Z").shell(-2)
mold.add(part, name="성형품_케이스", color=C(0.95, 0.95, 0.9), loc=cq.Location((0, 0, z)))
z += 45
top = pl(25).faces(">Z").workplane().hole(30)
mold.add(top, name="상측_고정판", color=C(0.3, 0.32, 0.36), loc=cq.Location((0, 0, z + 12.5)))
mold.add(cq.Workplane("XY").circle(15).extrude(45).faces(">Z").hole(6), name="스프루_부시",
         color=C(0.9, 0.7, 0.2), loc=cq.Location((0, 0, z - 20)))
mold.add(cq.Workplane("XY").circle(50).circle(15).extrude(10), name="로케이팅_링",
         color=C(0.2, 0.2, 0.22), loc=cq.Location((0, 0, z + 25)))
mold.export(os.path.join(OUT, "mold_assembly.step"))

# ── 3) 단일 STL ─────────────────────────────────────────────────
cq.exporters.export(lid, os.path.join(OUT, "cover_single.stl"))

# ── 4) DXF 브래킷 판재 (mm, 치수 포함) ────────────────────────────
doc = ezdxf.new("R2010", setup=True); doc.units = ezdxf.units.MM
doc.header["$INSUNITS"] = 4
msp = doc.modelspace()
for name, col in (("OUTLINE", 7), ("HOLES", 1), ("DIM", 3), ("CENTER", 5), ("TEXT", 2)):
    doc.layers.add(name, color=col)
msp.add_lwpolyline([(0, 0), (200, 0), (200, 120), (0, 120)], close=True, dxfattribs={"layer": "OUTLINE"})
for x, y in ((15, 15), (185, 15), (15, 105), (185, 105)):
    msp.add_circle((x, y), 4.5, dxfattribs={"layer": "HOLES"})
msp.add_circle((100, 60), 20, dxfattribs={"layer": "HOLES"})
slot = msp.add_lwpolyline([(140, 50, 0), (160, 50, 1), (160, 70, 0), (140, 70, 1)], format="xyb", close=True,
                          dxfattribs={"layer": "HOLES"})
msp.add_line((100, -5), (100, 125), dxfattribs={"layer": "CENTER"})
msp.add_linear_dim(base=(0, -15), p1=(0, 0), p2=(200, 0), dxfattribs={"layer": "DIM"}).render()
msp.add_linear_dim(base=(-15, 0), p1=(0, 0), p2=(0, 120), angle=90, dxfattribs={"layer": "DIM"}).render()
msp.add_text("BRACKET PLATE  MAT: SS400  T=?", dxfattribs={"layer": "TEXT", "height": 5}).set_placement((0, 130))
doc.saveas(os.path.join(OUT, "bracket_plate.dxf"))
print("samples written to", os.path.abspath(OUT))

# ── 5) 벡터 PDF 도면 (축척 1:2, A4 가로, 도곽·표제란·치수·중심선 포함) ──────
def pdf_bracket(path, rotate=0):
    MM = 72 / 25.4
    S = 0.5  # 1:2
    ox, oy = 40 * MM, 60 * MM
    P = lambda x, y: (ox + x * S * MM, oy + y * S * MM)
    ops = ["0 0 0 RG 0.6 w"]
    def rect(x0, y0, x1, y1): ops.append(f"{x0:.3f} {y0:.3f} {x1-x0:.3f} {y1-y0:.3f} re S")
    def poly(pts, close=True):
        ops.append(" ".join([f"{pts[0][0]:.3f} {pts[0][1]:.3f} m"] + [f"{x:.3f} {y:.3f} l" for x, y in pts[1:]]) + (" h S" if close else " S"))
    def circle(cx, cy, r, op="S"):
        k = 0.5523 * r
        ops.append(f"{cx+r:.3f} {cy:.3f} m {cx+r:.3f} {cy+k:.3f} {cx+k:.3f} {cy+r:.3f} {cx:.3f} {cy+r:.3f} c "
                   f"{cx-k:.3f} {cy+r:.3f} {cx-r:.3f} {cy+k:.3f} {cx-r:.3f} {cy:.3f} c "
                   f"{cx-r:.3f} {cy-k:.3f} {cx-k:.3f} {cy-r:.3f} {cx:.3f} {cy-r:.3f} c "
                   f"{cx+k:.3f} {cy-r:.3f} {cx+r:.3f} {cy-k:.3f} {cx+r:.3f} {cy:.3f} c h {op}")
    def text(x, y, s, size=9): ops.append(f"BT /F1 {size} Tf {x:.3f} {y:.3f} Td ({s}) Tj ET")
    W, H = 297 * MM, 210 * MM
    rect(10 * MM, 10 * MM, W - 10 * MM, H - 10 * MM)              # 도곽
    rect(W - 110 * MM, 10 * MM, W - 10 * MM, 40 * MM)             # 표제란
    text(W - 105 * MM, 30 * MM, "BRACKET PLATE  MAT: SS400", 10)
    text(W - 105 * MM, 18 * MM, "SCALE 1:2   UNIT: mm", 10)
    ops.append("1.0 w")
    poly([P(0, 0), P(200, 0), P(200, 120), P(0, 120)])            # 외곽 (선 4개가 아닌 닫힌 경로)
    for x, y in ((15, 15), (185, 15), (15, 105), (185, 105)):
        circle(*P(x, y), 4.5 * S * MM)
    circle(*P(100, 60), 20 * S * MM)
    # 장공: 선 2개 + 반원 2개 (열린 선분 연결 시험)
    poly([P(140, 50), P(160, 50)], close=False); poly([P(160, 70), P(140, 70)], close=False)
    import math
    arc = lambda cx, cy, a0, a1: [P(cx + 10 * math.cos(a), cy + 10 * math.sin(a)) for a in [a0 + (a1 - a0) * i / 16 for i in range(17)]]
    poly(arc(160, 60, -math.pi / 2, math.pi / 2), close=False); poly(arc(140, 60, math.pi / 2, 3 * math.pi / 2), close=False)
    ops.append("0.3 w [6 2 1 2] 0 d")                              # 중심선(점선)
    poly([P(100, -8), P(100, 128)], close=False)
    ops.append("[] 0 d 0.3 w")
    poly([P(0, -12), P(200, -12)], close=False)                    # 치수선 + 채움 화살표
    for x, d in ((0, 1), (200, -1)):
        a = P(x, -12); ops.append(f"{a[0]:.3f} {a[1]:.3f} m {a[0]+d*6:.3f} {a[1]+1.5:.3f} l {a[0]+d*6:.3f} {a[1]-1.5:.3f} l h f")
    text(*P(95, -10), "200"); text(*P(-14, 58), "120")
    content = "\n".join(ops).encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            f"<< /Type /Page /Parent 2 0 R /Rotate {rotate} /MediaBox [0 0 {W:.2f} {H:.2f}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".encode(),
            b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = b"%PDF-1.4\n"; offs = []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += f"{i+1} 0 obj\n".encode() + o + b"\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer << /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    open(path, "wb").write(out)
pdf_bracket(os.path.join(OUT, "bracket_plate_1to2.pdf"))
pdf_bracket(os.path.join(OUT, "bracket_plate_rot270.pdf"), rotate=270)  # 회전 페이지 (CAD 출력 PDF 에 흔함)

# ── 6) 스캔 PDF (이미지만 있는 도면) ─────────────────────────────────
from PIL import Image, ImageDraw
img = Image.new("L", (1240, 877), 255); d = ImageDraw.Draw(img)
d.rectangle([200, 300, 800, 660], outline=0, width=4); d.ellipse([460, 440, 540, 520], outline=0, width=4)
img.save(os.path.join(OUT, "scanned_drawing.pdf"), resolution=150)
print("pdf samples written")
