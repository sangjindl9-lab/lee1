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
