"""DXF 실제 객체 분석 (ezdxf). DWG 는 외부 변환기로 DXF 변환 후 동일 경로.

출력 SheetData:
  units, bbox, layers, entities(요약: INSERT/LINE/POLY/ARC/CIRCLE/TEXT/MTEXT/LEADER/DIM/HATCH),
  blocks(블록 정의 지문), prims(뷰어용 선분 지오메트리), warnings(XREF 누락, 미지원 객체).
"""
from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass, field
import re
from pathlib import Path

import ezdxf
from ezdxf.math import Matrix44, Vec3

from ..config import settings
from .geometry import arc_points, bbox_of, bulge_to_arc_points, polyline_length, shape_fingerprint

# $INSUNITS 코드 → 단위
INSUNITS = {0: "unknown", 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 14: "dm"}
UNIT_TO_M = {"mm": 0.001, "cm": 0.01, "dm": 0.1, "m": 1.0, "in": 0.0254, "ft": 0.3048}


@dataclass
class SheetData:
    source_kind: str
    units: str
    scale_factor: float | None     # 도면단위 → m, 단위 불명이면 None
    bbox: dict | None
    layers: list[dict]
    entities: list[dict]
    blocks: dict[str, dict]
    prims: list[dict]              # 뷰어/매칭용 프리미티브
    texts: list[dict]
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    sheet_name: str = "Model"


class ConversionError(Exception):
    pass


DWG_VERSIONS = {b"AC1012": "R13", b"AC1014": "R14", b"AC1015": "AutoCAD 2000", b"AC1018": "AutoCAD 2004",
                b"AC1021": "AutoCAD 2007", b"AC1024": "AutoCAD 2010", b"AC1027": "AutoCAD 2013", b"AC1032": "AutoCAD 2018"}


def find_dwg2dxf() -> str | None:
    import shutil
    for cand in ("dwg2dxf", "/opt/libredwg/bin/dwg2dxf", "/usr/local/bin/dwg2dxf"):
        p = shutil.which(cand) or (cand if Path(cand).exists() else None)
        if p:
            return p
    return None


def convert_dwg_to_dxf(dwg_path: Path, out_dir: Path) -> tuple[Path, list[str]]:
    """DWG → DXF. 1) KET_DWG_CONVERTER_CMD (예: ODA File Converter) 가 설정되면 그것을, 2) 없으면 내장 LibreDWG(dwg2dxf, GPL 별도 실행)를 쓴다.
    변환기가 없거나 실패하면 ConversionError — 성공한 척 하지 않는다. 반환: (dxf 경로, 경고 목록)"""
    out_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    head = dwg_path.read_bytes()[:6]
    ver = DWG_VERSIONS.get(head)
    if not head.startswith(b"AC10"):
        raise ConversionError("DWG 파일 형식이 아닙니다(헤더 불일치). 파일이 손상되었는지 확인하십시오.")
    if settings.dwg_converter_cmd:
        cmd = settings.dwg_converter_cmd.format(**{"in": str(dwg_path), "out_dir": str(out_dir)})
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            raise ConversionError(f"DWG 변환 실패(code {proc.returncode}): {proc.stderr[:500]}")
        cands = list(out_dir.glob("*.dxf")) + list(out_dir.glob("*.DXF"))
        if not cands:
            raise ConversionError("DWG 변환기가 DXF 파일을 생성하지 않았습니다.")
        return cands[0], warnings
    exe = find_dwg2dxf()
    if not exe:
        raise ConversionError("서버에 DWG 변환기(LibreDWG dwg2dxf)가 설치되어 있지 않습니다. 관리자에게 문의하거나 CAD 에서 DXF 로 저장해 업로드하십시오.")
    if ver is None:
        warnings.append(f"DWG 버전 코드 {head.decode(errors='replace')} — 지원 범위(R13~2018 형식) 밖일 수 있습니다.")
    out = out_dir / (dwg_path.stem + ".dxf")
    if out.exists():
        out.unlink()
    import os
    env = {**os.environ, "LD_LIBRARY_PATH": "/opt/libredwg/lib:" + os.environ.get("LD_LIBRARY_PATH", "")}
    try:
        proc = subprocess.run([exe, "-y", "-o", str(out), str(dwg_path)], capture_output=True, text=True, timeout=900, env=env)
    except subprocess.TimeoutExpired:
        raise ConversionError("DWG 변환이 15분 안에 끝나지 않았습니다. 도면을 나누거나 DXF 로 저장해 업로드하십시오.")
    if not out.exists() or out.stat().st_size < 200:
        err = (proc.stderr or proc.stdout or "")[-500:]
        raise ConversionError(f"DWG 변환 실패({ver or '버전 미상'}): {err or '출력 파일 없음'}")
    try:
        resolved = resolve_anonymous_inserts(dwg_path, out)
    except Exception as ex:   # 복원 실패해도 변환 결과는 사용 (경고로 알림)
        resolved, warnings = 0, warnings + [f"동적 블록 이름 복원 실패: {type(ex).__name__}"]
    if resolved:
        warnings.append(f"동적 블록 {resolved}개의 원래 블록명을 복원했습니다 (예: '*U' → 'con 1구').")
    fixed = repair_dxf_text_breaks(out)
    if fixed:
        warnings.append(f"변환된 DXF 에서 줄바꿈이 섞인 문자열 {fixed}곳을 복구했습니다 (여러 줄 문자).")
    warnings.append(f"DWG({ver or '버전 미상'}) 를 LibreDWG 로 DXF 변환했습니다. 표(ACAD_TABLE)·와이프아웃·호 치수 객체는 변환되지 않을 수 있습니다"
                    " — 범례가 CAD '표' 객체로 그려진 경우 범례 영역을 수동 지정하거나 DXF 로 저장해 올리십시오.")
    return out, warnings



def _is_group_code(line: bytes) -> bool:
    t = line.strip()
    if t[:1] == b"-":
        t = t[1:]
    return 0 < len(t) <= 4 and t.isdigit()



def find_dwgread() -> str | None:
    import shutil
    for cand in ("dwgread", "/opt/libredwg/bin/dwgread", "/usr/local/bin/dwgread"):
        p = shutil.which(cand) or (cand if Path(cand).exists() else None)
        if p:
            return p
    return None


_HEX = re.compile(r"\(\d+\.\d+\.([0-9A-F]+)\)")


def resolve_anonymous_inserts(dwg_path: Path, dxf_path: Path, timeout: int = 600) -> int:
    """동적 블록 참조 복원. LibreDWG 는 동적 블록 인스턴스(익명 블록 *U###)를 DXF 에 이름 '*U' 로만 써서
    어떤 기호인지 잃어버린다. dwgread -v3 덤프에서
      INSERT 핸들 → 익명 블록 핸들, 익명 블록의 EED(AcDbBlockRepBTag, 코드 5) → 원본 동적 블록 핸들
    을 읽어 DXF 의 INSERT 이름을 원본 블록명(예: 'con 1구')으로 바꾼다. 바꾼 개수 반환."""
    import subprocess
    data = dxf_path.read_bytes()
    if b"\n*U\r\n" not in data and b"\n*U\n" not in data:
        return 0
    exe = find_dwgread()
    if not exe:
        return 0
    proc = subprocess.Popen([exe, "-v3", str(dwg_path)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    ins2blk: dict[str, str] = {}
    anon_src: dict[str, str] = {}
    cur_type, cur_h, cur_anon = None, None, False
    try:
        import time
        t0 = time.time()
        for raw in proc.stdout:
            if time.time() - t0 > timeout:
                proc.kill()
                break
            line = raw.decode("utf-8", "replace")
            if line.startswith("Add entity ") or line.startswith("Add table record ") or line.startswith("Add object "):
                parts = line.split()
                cur_type = parts[3] if line.startswith("Add table record") else parts[2]
                cur_h, cur_anon = None, False
                continue
            if line.startswith("handle: ") and cur_h is None:
                cur_h = line.split()[1].split(".")[-1]
                continue
            if cur_type in ("INSERT", "MINSERT") and line.startswith("block_header:"):
                m = _HEX.search(line)
                if m and cur_h:
                    ins2blk[cur_h] = m.group(1)
            elif cur_type == "BLOCK_HEADER":
                if "code: 5 [RC], entity:" in line and cur_h:
                    anon_src.setdefault(cur_h, line.rsplit("entity:", 1)[1].split()[0].strip())
    finally:
        proc.stdout.close()
        proc.wait()
    if not ins2blk or not anon_src:
        return 0
    # DXF: BLOCK_RECORD 핸들 → 이름(원래 바이트 그대로, 코드페이지 보존)
    nl = b"\r\n" if b"\r\n" in data[:2000] else b"\n"
    lines = data.split(nl)
    rec_name: dict[str, bytes] = {}
    i = 0
    n = len(lines)
    while i + 1 < n:
        if lines[i].strip() == b"0" and lines[i + 1].strip() == b"BLOCK_RECORD":
            j, h, name = i + 2, None, None
            while j + 1 < n and lines[j].strip() != b"0":
                c = lines[j].strip()
                if c == b"5" and h is None:
                    h = lines[j + 1].strip().decode("ascii", "ignore").upper()
                elif c == b"2" and name is None:
                    name = lines[j + 1]
                j += 2
            if h and name is not None:
                rec_name[h] = name
            i = j
            continue
        i += 1
    changed = 0
    i = 0
    while i + 1 < n:
        if lines[i].strip() == b"0" and lines[i + 1].strip() == b"INSERT":
            j, h, name_idx = i + 2, None, None
            while j + 1 < n and lines[j].strip() != b"0":
                c = lines[j].strip()
                if c == b"5" and h is None:
                    h = lines[j + 1].strip().decode("ascii", "ignore").upper()
                elif c == b"2" and name_idx is None:
                    name_idx = j + 1
                j += 2
            if h and name_idx is not None and lines[name_idx].strip() == b"*U":
                tgt = ins2blk.get(h, "").upper()
                nm = rec_name.get(tgt)
                if nm is None or nm.strip().startswith(b"*"):
                    src = anon_src.get(tgt, "").upper()      # 익명 블록 → 원본 동적 블록
                    nm = rec_name.get(src)
                if nm is not None and not nm.strip().startswith(b"*"):
                    lines[name_idx] = nm
                    changed += 1
            i = j
            continue
        i += 1
    if changed:
        dxf_path.write_bytes(nl.join(lines))
    return changed

def repair_dxf_text_breaks(path: Path) -> int:
    """LibreDWG 는 여러 줄 문자(MTEXT/속성)의 줄바꿈을 그대로 써서 DXF '코드/값' 짝을 깨뜨린다.
    그룹코드 자리에 숫자가 아닌 줄이 오면 앞 값의 이어지는 줄로 보고 '\\P'(MTEXT 줄바꿈)로 합친다. 복구 건수 반환."""
    data = path.read_bytes()
    lines = data.split(b"\n")
    out: list[bytes] = []
    i, n, fixed = 0, len(lines), 0
    while i < n:
        code = lines[i].rstrip(b"\r")
        if not _is_group_code(code):
            if not code.strip() and i == n - 1:
                break
            if out:
                out[-1] = out[-1] + b"\\P" + code
                fixed += 1
                i += 1
                continue
        out.append(code)
        if i + 1 < n:
            out.append(lines[i + 1].rstrip(b"\r"))
        i += 2
    if fixed:
        path.write_bytes(b"\r\n".join(out) + b"\r\n")
    return fixed

def _v(p) -> tuple[float, float]:
    return (float(p[0]), float(p[1]))


def _entity_prims(e, m: Matrix44 | None = None) -> tuple[list[dict], list[str]]:
    """단일 엔터티 → 프리미티브(선분 점열). 변환행렬 m 적용."""
    def tf(pt):
        if m is None:
            return _v(pt)
        v = m.transform(Vec3(pt))
        return (v.x, v.y)

    t = e.dxftype()
    prims, texts = [], []
    if t == "LINE":
        prims.append({"t": "l", "p": [tf(e.dxf.start), tf(e.dxf.end)]})
    elif t == "LWPOLYLINE":
        pts = list(e.get_points("xyb"))
        out = []
        for i in range(len(pts) - 1 + (1 if e.closed else 0)):
            p0 = pts[i]
            p1 = pts[(i + 1) % len(pts)]
            seg = bulge_to_arc_points((p0[0], p0[1]), (p1[0], p1[1]), p0[2])
            out.extend(seg if not out else seg[1:])
        if out:
            prims.append({"t": "l", "p": [tf(p) for p in out]})
    elif t == "POLYLINE":
        pts = [tf(v.dxf.location) for v in e.vertices]
        if e.is_closed and pts:
            pts.append(pts[0])
        if len(pts) >= 2:
            prims.append({"t": "l", "p": pts})
    elif t == "ARC":
        pts = arc_points(e.dxf.center.x, e.dxf.center.y, e.dxf.radius, e.dxf.start_angle, e.dxf.end_angle)
        prims.append({"t": "a", "p": [tf(p) for p in pts], "r": e.dxf.radius})
    elif t == "CIRCLE":
        pts = arc_points(e.dxf.center.x, e.dxf.center.y, e.dxf.radius, 0, 360, 24)
        prims.append({"t": "c", "p": [tf(p) for p in pts], "r": e.dxf.radius, "c": tf(e.dxf.center)})
    elif t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
        s = e.plain_text() if hasattr(e, "plain_text") else e.dxf.text
        texts.append(s)
    elif t in ("SPLINE", "ELLIPSE"):
        try:
            pts = [tf(p) for p in e.flattening(0.5)]
            if len(pts) >= 2:
                prims.append({"t": "l", "p": pts})
        except Exception:
            pass
    elif t == "HATCH":
        for path in e.paths:
            try:
                verts = [tf(v) for v in path.vertices] if hasattr(path, "vertices") else []
                if len(verts) >= 2:
                    prims.append({"t": "h", "p": verts + [verts[0]]})
            except Exception:
                pass
    elif t in ("LEADER", "MLEADER"):
        try:
            verts = [tf(v) for v in (e.vertices if t == "LEADER" else e.context.leaders[0].vertices)]
            if len(verts) >= 2:
                prims.append({"t": "ld", "p": verts})
        except Exception:
            pass
    return prims, texts


def block_fingerprint(doc, block_name: str, depth: int = 0) -> tuple[dict, list[dict], list[str]]:
    """블록 정의를 (중첩 포함) 펼쳐 지문·프리미티브·문자 생성 (블록 로컬 좌표)."""
    try:
        blk = doc.blocks[block_name]
    except KeyError:
        return {"hash": "missing", "n": 0}, [], []
    prims, texts = [], []
    for e in blk:
        if e.dxftype() == "INSERT" and depth < 4:
            _, sub_prims, sub_texts = block_fingerprint(doc, e.dxf.name, depth + 1)
            m = e.matrix44()
            for pr in sub_prims:
                prims.append({**pr, "p": [(m.transform(Vec3(p)).x, m.transform(Vec3(p)).y) for p in pr["p"]]})
            texts.extend(sub_texts)
        else:
            p, tx = _entity_prims(e)
            prims.extend(p)
            texts.extend(tx)
    return shape_fingerprint(prims, texts), prims, texts


def parse_dxf(path: Path, layout: str = "Model") -> SheetData:
    try:
        try:
            doc = ezdxf.readfile(str(path))
        except ezdxf.DXFStructureError:
            # 변환기 출력 등 약간 어긋난 DXF 는 복구 모드로 읽는다
            from ezdxf import recover
            doc, _aud = recover.readfile(str(path))
    except ezdxf.DXFStructureError as ex:
        raise ConversionError(f"DXF 구조 오류: {ex}")
    except Exception as ex:  # 인코딩 등
        raise ConversionError(f"DXF 읽기 실패: {ex}")

    warnings: list[str] = []
    units_code = int(doc.header.get("$INSUNITS", 0))
    units = INSUNITS.get(units_code, "unknown")
    scale = UNIT_TO_M.get(units)
    if scale is None:
        warnings.append("도면 단위($INSUNITS)가 지정되지 않았습니다. 길이 산출 전 단위/축척 확인이 필요합니다.")

    msp = doc.modelspace() if layout == "Model" else doc.layouts.get(layout)

    # XREF 확인
    for br in doc.block_records:
        if br.is_xref:
            warnings.append(f"XREF 블록 '{br.dxf.name}' 은 외부 참조입니다. 참조 파일이 첨부되지 않으면 해당 내용은 분석되지 않습니다.")

    layers = [{"name": L.dxf.name, "color": L.color, "count": 0} for L in doc.layers]
    layer_counts: dict[str, int] = {}

    entities, prims, texts = [], [], []
    blocks: dict[str, dict] = {}
    unsupported: dict[str, int] = {}
    all_pts: list[tuple[float, float]] = []

    for e in msp:
        t = e.dxftype()
        layer = e.dxf.layer
        layer_counts[layer] = layer_counts.get(layer, 0) + 1
        handle = e.dxf.handle
        base = {"h": handle, "t": t, "layer": layer}

        if t == "INSERT":
            name = e.dxf.name
            if name not in blocks:
                fp, bprims, btexts = block_fingerprint(doc, name)
                blocks[name] = {"fingerprint": fp, "prims": bprims, "texts": btexts,
                                "is_xref": doc.block_records.get(name).is_xref if name in doc.block_records else False}
            m = e.matrix44()
            ins = _v(e.dxf.insert)
            attrs = {a.dxf.tag: a.dxf.text for a in e.attribs} if e.attribs else {}
            # 뷰어용 펼침
            bpts = []
            for pr in blocks[name]["prims"]:
                tp = [(m.transform(Vec3(p)).x, m.transform(Vec3(p)).y) for p in pr["p"]]
                prims.append({**pr, "p": tp, "h": handle, "layer": layer, "blk": name})
                bpts.extend(tp)
            bb = bbox_of(bpts) if bpts else {"x0": ins[0], "y0": ins[1], "x1": ins[0], "y1": ins[1]}
            all_pts.extend(bpts or [ins])
            entities.append({**base, "block": name, "x": ins[0], "y": ins[1],
                             "rot": float(e.dxf.rotation), "scale": float(e.dxf.xscale),
                             "attrs": attrs, "bbox": bb, "texts": blocks[name]["texts"]})
            for tag, val in attrs.items():
                texts.append({"h": handle, "text": val, "x": ins[0], "y": ins[1], "layer": layer, "attr": tag})
            continue

        p, tx = _entity_prims(e)
        if t in ("TEXT", "MTEXT"):
            pos = e.dxf.insert if t == "TEXT" else e.dxf.insert
            s = tx[0] if tx else ""
            h = float(e.dxf.height if t == "TEXT" else e.dxf.char_height)
            w = h * 0.7 * max(len(s), 1)
            ent = {**base, "text": s, "x": pos.x, "y": pos.y, "height": h,
                   "bbox": {"x0": pos.x, "y0": pos.y - (0 if t == "TEXT" else h * 1.2 * s.count("\n")), "x1": pos.x + w, "y1": pos.y + h}}
            entities.append(ent)
            texts.append({"h": handle, "text": s, "x": pos.x, "y": pos.y, "layer": layer, "height": h, "bbox": ent["bbox"]})
            all_pts.append((pos.x, pos.y))
            continue
        if p:
            for pr in p:
                prims.append({**pr, "h": handle, "layer": layer})
                all_pts.extend(pr["p"])
            length = sum(polyline_length(pr["p"]) for pr in p if pr["t"] in ("l", "a"))
            ent = {**base, "length": length, "bbox": bbox_of([q for pr in p for q in pr["p"]]), "points": p[0]["p"] if len(p) == 1 else None}
            if t == "CIRCLE":
                ent["center"] = p[0]["c"]
                ent["radius"] = p[0]["r"]
            entities.append(ent)
        elif t == "DIMENSION":
            try:
                entities.append({**base, "text": e.dxf.text, "measure": float(e.get_measurement()), "x": float(e.dxf.defpoint.x), "y": float(e.dxf.defpoint.y)})
            except Exception:
                entities.append({**base})
        else:
            unsupported[t] = unsupported.get(t, 0) + 1

    for L in layers:
        L["count"] = layer_counts.get(L["name"], 0)
    if unsupported:
        warnings.append("미지원 CAD 객체(분석 제외): " + ", ".join(f"{k}×{v}" for k, v in unsupported.items()))

    bbox = bbox_of(all_pts) if all_pts else None
    stats = {"entities": len(entities), "inserts": sum(1 for e in entities if e["t"] == "INSERT"),
             "texts": len(texts), "blocks": len(blocks), "prims": len(prims)}
    return SheetData(source_kind="dxf", units=units, scale_factor=scale, bbox=bbox, layers=layers,
                     entities=entities, blocks=blocks, prims=prims, texts=texts, warnings=warnings,
                     stats=stats, sheet_name=layout)
