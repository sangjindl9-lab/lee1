"""터널 통합전력관리 운영 서버.

실행:  python -m app.main            (config.json 의 simulator.embedded=true 이면 가상 PLC 도 함께 기동)
접속:  http://<서버IP>:8080
"""
import asyncio
import contextlib
import json
import logging
import math
import os
import secrets
import time

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response

from .store import ROLES, Store
from .tagmap import FEEDER_USE, MAX_GATES, MAX_VMS, STAGES, display_addr, parse_rows, read_table_file, reset_tags, save_tags, to_xlsx
from . import drivers as D
from .protocols import PROTOCOLS, make_driver
from .tagmap import load_tags
from .tunnel import Alarms, Tunnel, cam_url, plc_opt
from .vendors import BUILTIN

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.environ.get("SCADA_CONFIG", os.path.join(BASE, "config.json"))
with open(CFG_PATH, encoding="utf-8") as f:
    CFG = json.load(f)
if os.environ.get("PORT"):                     # 클라우드 시연 배포용
    CFG["http_port"] = int(os.environ["PORT"])

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scada")

store = Store(BASE)
CFG["control"].update(store.get("control", {}) or {})     # 화면에서 바꾼 제어 기준값 우선
alarms = Alarms(store)
SIM_ON = CFG.get("simulator", {}).get("embedded", False)
for _t in CFG["tunnels"]:
    _t["_sim"] = SIM_ON or CFG.get("clock") == "plc"     # 가상 PLC 전용 신호(SIM.*)는 시뮬레이터일 때만 읽음
tunnels = {t["key"]: Tunnel(t, CFG["control"], CFG.get("clock", "real"), store, alarms, BASE) for t in CFG["tunnels"]}
TOKENS = {}
SOCKETS = set()
TOKEN_TTL = 12 * 3600


# ---------- 인증 ----------
def user_from_token(tok):
    u = TOKENS.get(tok or "")
    if not u or u["exp"] < time.time():
        return None
    u["exp"] = time.time() + TOKEN_TTL
    return u["user"]


def need(role):
    def dep(request: Request):
        tok = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or request.query_params.get("token")
        u = user_from_token(tok)
        if not u:
            raise HTTPException(401, "로그인이 필요합니다")
        if ROLES[u["role"]] < ROLES[role]:
            raise HTTPException(403, "%s 권한이 필요합니다 (현재: %s)" % (role, u["role"]))
        return u
    return dep


# ---------- 주기 루프 ----------
def snapshot():
    return {"type": "state", "site": CFG.get("site_name", ""), "sim": SIM_ON,
            "tunnels": {k: t.state or {"key": k, "comm": False} for k, t in tunnels.items()},
            "alarms": alarms.snapshot(), "events": store.recent_events(150)}


async def broadcast(msg):
    dead = []
    data = json.dumps(msg, ensure_ascii=False)
    for ws in list(SOCKETS):
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        SOCKETS.discard(ws)


async def scan_loop():
    period = CFG.get("poll_ms", 1000) / 1000
    last_prune = 0
    while True:
        t0 = time.monotonic()
        await asyncio.gather(*(t.cycle() for t in tunnels.values()))
        await broadcast(snapshot())
        if time.time() - last_prune > 86400:
            last_prune = time.time()
            store.prune()
        await asyncio.sleep(max(.05, period - (time.monotonic() - t0)))


@contextlib.asynccontextmanager
async def lifespan(app):
    tasks = []
    if SIM_ON:
        from sim.plc_sim import run as sim_run
        tasks.append(asyncio.create_task(sim_run(CFG_PATH, host="127.0.0.1")))
        await asyncio.sleep(1.0)
    for t in tunnels.values():
        t.log("운영 서버 기동")
    tasks.append(asyncio.create_task(scan_loop()))
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="터널 통합전력관리", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(Exception)
async def err(request, exc):
    log.exception("요청 오류")
    return JSONResponse({"detail": str(exc)}, status_code=500)


# ---------- 화면 ----------
@app.get("/")
def index():
    return FileResponse(os.path.join(BASE, "web", "index.html"), headers={"Cache-Control": "no-store"})


# ---------- API ----------
@app.post("/api/login")
async def login(body: dict):
    u = store.check_user(str(body.get("id", "")), str(body.get("pw", "")))
    if not u:
        await asyncio.sleep(1)
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
    tok = secrets.token_urlsafe(24)
    TOKENS[tok] = {"user": u, "exp": time.time() + TOKEN_TTL}
    store.event("", "시스템", "op", "로그인 · %s (%s)" % (u["name"], u["role"]), u["id"])
    return {"token": tok, "user": u}


@app.post("/api/logout")
def logout(request: Request):
    TOKENS.pop(request.headers.get("authorization", "").removeprefix("Bearer ").strip(), None)
    return {"ok": True}


@app.post("/api/password")
def password(body: dict, u=Depends(need("감시"))):
    if not store.check_user(u["id"], str(body.get("old", ""))):
        raise HTTPException(400, "현재 비밀번호가 맞지 않습니다")
    new = str(body.get("new", ""))
    if len(new) < 8:
        raise HTTPException(400, "새 비밀번호는 8자 이상이어야 합니다")
    store.set_password(u["id"], new)
    u["must_change"] = False
    return {"ok": True}


@app.get("/api/meta")
def meta(u=Depends(need("감시"))):
    return {"site": CFG.get("site_name", ""), "sim": SIM_ON, "user": u, "stages": [s["k"] for s in STAGES],
            "use": FEEDER_USE,
            "tunnels": [{"key": t.key, "name": t.name, "sta": t.c["sta"], "fans": t.c["fans"], "ups": t.c["ups_kva"],
                         "rtu": t.c.get("rtu_points"), "com": t.c.get("com_points"),
                         "lv": [f for f in t.c["feeders"] if f != "LV-UPS"], "feeders": t.c["feeders"],
                         "host": t.devcfg["plc"]["host"], "port": t.devcfg["plc"]["port"], "unit": t.devcfg["plc"]["unit"],
                         "dev": public_devices(t.devcfg)} for t in tunnels.values()],
            "control": CFG["control"], "maxVms": MAX_VMS, "maxGates": MAX_GATES, "protocols": PROTOCOLS}


def public_devices(d):
    """화면으로 보내는 설비 설정 (카메라 비밀번호는 보내지 않음)."""
    out = json.loads(json.dumps(d))
    out["plc"]["has_ua_pw"] = bool(out["plc"].pop("ua_pw", ""))
    for c in out["cctv"]:
        c["has_pw"] = bool(c.pop("pw", ""))
        try:
            c["mjpeg_url"] = cam_url(c, "mjpeg") if c["mode"] == "mjpeg" else ""
        except (KeyError, IndexError, ValueError):
            c["mjpeg_url"] = ""
    return out


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    if not user_from_token(websocket.query_params.get("token")):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    SOCKETS.add(websocket)
    try:
        await websocket.send_text(json.dumps(snapshot(), ensure_ascii=False))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        SOCKETS.discard(websocket)


def T(key):
    if key not in tunnels:
        raise HTTPException(404, "터널을 찾을 수 없습니다")
    return tunnels[key]


@app.post("/api/cmd")
async def cmd(body: dict, u=Depends(need("운영"))):
    t = T(body.get("tunnel"))
    try:
        await t.command(body.get("action"), body, u)
    except (RuntimeError, ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    t.derive()
    await broadcast(snapshot())
    return {"ok": True}


@app.post("/api/sim")
async def sim(body: dict, u=Depends(need("운영"))):
    t = T(body.get("tunnel"))
    try:
        await t.sim(body.get("action"), body, u)
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.post("/api/ack")
async def ack(body: dict, u=Depends(need("운영"))):
    aid = body.get("id")
    hit = alarms.ack(int(aid) if aid is not None else None, u["name"], "")
    for a in hit:
        tunnels[a["tkey"]].log("경보 확인 · " + a["msg"], "op", u["name"])
    await broadcast(snapshot())
    return {"ok": True, "n": len(hit)}


@app.get("/api/trend")
def trend(tunnel: str, n: int = 180, u=Depends(need("감시"))):
    return T(tunnel) and store.trend(tunnel, max(10, min(n, 2000)))


def fmt(t, v):
    if t["dtype"] == "bool":
        return "1 (ON)" if v else "0 (OFF)"
    if v is None:
        return "–"
    d = max(0, min(5, -int(math.floor(math.log10(t["scale"]))))) if t["scale"] < 1 else 0
    return ("%." + str(d) + "f") % v + (" " + t["unit"] if t["unit"] else "")


@app.get("/api/tags")
def tags(tunnel: str, u=Depends(need("감시"))):
    t = T(tunnel)
    proto = t.devcfg["plc"].get("protocol", "modbus")
    return {"custom": t.custom, "protocol": proto, "protoName": PROTOCOLS.get(proto, proto),
            "rows": [{"tag": x["tag"], "desc": x["desc"], "type": x["type"], "addr": display_addr(x),
                      "paddr": "" if proto == "modbus" else x.get("pa", ""),
                      "value": fmt(x, t.v.get(x["tag"])) if t.comm else "통신두절"}
                     for x in t.dev.tags.values()]}


@app.post("/api/tags/import")
async def tags_import(tunnel: str, file: UploadFile = File(...), u=Depends(need("관리자"))):
    t = T(tunnel)
    rows, errs = parse_rows(read_table_file(file.filename or "", await file.read()))
    if errs:
        raise HTTPException(400, "일람표 오류 %d건: " % len(errs) + " / ".join(errs[:5]))
    if not rows:
        raise HTTPException(400, "관제점이 없습니다. 첫 줄 머리글(태그·설명·구분·주소)을 확인하세요")
    save_tags(BASE, t.key, rows)
    t.reload_tags()
    t.log("관제점 일람표 적용 · %d점 (%s)" % (len(rows), file.filename), "op", u["name"])
    return {"ok": True, "n": len(rows)}


@app.post("/api/tags/reset")
def tags_reset(tunnel: str, u=Depends(need("관리자"))):
    t = T(tunnel)
    reset_tags(BASE, t.key)
    t.reload_tags()
    t.log("관제점 맵 기본값 복원", "op", u["name"])
    return {"ok": True}


@app.get("/api/tags/export")
def tags_export(tunnel: str, u=Depends(need("감시"))):
    t = T(tunnel)
    p = t.devcfg["plc"]
    proto = p.get("protocol", "modbus")
    data = to_xlsx([x for x in t.dev.tags.values() if not x["tag"].startswith("SIM.")], t.name,
                   (lambda x: x.get("pa") or x.get("paddr", "")) if proto != "modbus" else (lambda x: x.get("paddr", "")))
    fn = "%s_관제점일람표.xlsx" % t.name
    from urllib.parse import quote
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(fn)})


# ---------- 설비 설정 ----------
CTL_KEYS = {"co_steps": list, "co_hyst": float, "vi_limit": float, "light_lum": list, "late_night": list,
            "fire_fan_exclude": float, "alarm_co_warn": float, "alarm_co_crit": float, "alarm_vi_warn": float,
            "alarm_batt_low": float}


def _num(v, name):
    try:
        return float(v)
    except (TypeError, ValueError):
        raise HTTPException(400, "%s 값이 숫자가 아닙니다" % name)


def _s(v, n=300):
    return str(v if v is not None else "").strip()[:n]


def _int(v, name, lo, hi):
    x = int(_num(v, name))
    if not lo <= x <= hi:
        raise HTTPException(400, "%s 값은 %d~%d 사이여야 합니다" % (name, lo, hi))
    return x


def _addr(v, name):
    if _s(v) == "":
        return ""
    try:
        D.mb_addr(v)
    except ValueError:
        raise HTTPException(400, "%s 주소가 숫자가 아닙니다" % name)
    return _s(v, 10)


def clean_plc(p, old=None):
    proto = p.get("protocol") if p.get("protocol") in PROTOCOLS else "modbus"
    tr = p.get("transport") if p.get("transport") in ("tcp", "rtu_tcp", "ascii_tcp", "rtu_serial", "ascii_serial") else "tcp"
    serial = proto == "modbus" and tr.endswith("_serial")
    host = _s(p.get("host"), 100)
    if not host and not serial:
        raise HTTPException(400, "PLC IP 주소를 입력하세요")
    o = {"protocol": proto, "host": host, "port": _int(p.get("port") or 502, "PLC 포트", 1, 65535),
         "unit": _int(p.get("unit") if p.get("unit") not in (None, "") else 1, "Unit ID", 0, 255),
         "vendor": _s(p.get("vendor"), 60) or "generic", "word_order": "low" if p.get("word_order") == "low" else "high",
         "timeout": max(.3, min(30.0, _num(p.get("timeout", 2), "응답 대기")))}
    if proto == "modbus":
        o.update(transport=tr, addr_offset=_int(p.get("addr_offset", 0), "주소 보정", -100000, 100000),
                 block=_int(p.get("block", 100), "한 번에 읽기", 1, 125))
        if serial:
            sp = _s(p.get("serial_port"), 60)
            if not sp:
                raise HTTPException(400, "직렬 포트 이름을 입력하세요 (예: COM3, /dev/ttyUSB0)")
            o.update(serial_port=sp, baud=_int(p.get("baud") or 9600, "통신 속도", 300, 921600),
                     parity=p.get("parity") if p.get("parity") in ("N", "E", "O") else "N",
                     stopbits=1 if str(p.get("stopbits", 1)) != "2" else 2, bytesize=7 if str(p.get("bytesize", 8)) == "7" else 8)
    elif proto == "s7":
        o.update(s7_rack=_int(p.get("s7_rack") or 0, "랙", 0, 7), s7_slot=_int(p.get("s7_slot") if p.get("s7_slot") not in (None, "") else 1, "슬롯", 0, 31))
    elif proto == "fins":
        o.update(fins_mode="udp" if p.get("fins_mode") == "udp" else "tcp",
                 fins_plc_node=_int(p.get("fins_plc_node") or 0, "PLC 노드", 0, 254), fins_pc_node=_int(p.get("fins_pc_node") or 0, "PC 노드", 0, 254))
    elif proto == "mc":
        o.update(mc_net=_int(p.get("mc_net") or 0, "네트워크 번호", 0, 239),
                 mc_pc=_int(p.get("mc_pc") if p.get("mc_pc") not in (None, "") else 255, "PC 번호", 0, 255))
    elif proto == "opcua":
        pw = p.get("ua_pw")
        o.update(ua_url=_s(p.get("ua_url"), 200), ua_ns=_int(p.get("ua_ns") or 2, "네임스페이스", 0, 999),
                 ua_security=p.get("ua_security") if p.get("ua_security") in ("none", "Basic256Sha256_Sign", "Basic256Sha256_SignAndEncrypt") else "none",
                 ua_user=_s(p.get("ua_user"), 60),
                 ua_pw=(old or {}).get("ua_pw", "") if pw in (None, "") else ("" if pw == "__clear__" else str(pw)))
    elif proto == "eip":
        o.update(eip_mode="slc" if p.get("eip_mode") == "slc" else "logix", eip_slot=_s(p.get("eip_slot"), 4))
    return o


def clean_cam(c, oldpw):
    cid = _s(c.get("id"), 30)
    mode = c.get("mode", "sim")
    if mode not in ("sim", "snapshot", "mjpeg"):
        raise HTTPException(400, "영상 방식은 모의·스냅샷·MJPEG 중 하나입니다")
    pw = c.get("pw")
    out = {"id": cid, "name": _s(c.get("name"), 60) or cid, "pos": min(1, max(0, _num(c.get("pos", 0), cid + " 위치"))),
           "mode": mode, "vendor": _s(c.get("vendor"), 60) or "generic", "ip": _s(c.get("ip"), 100),
           "port": _int(c.get("port") or 80, cid + " 포트", 1, 65535), "ch": _s(c.get("ch"), 40) or "1",
           "auth": c.get("auth") if c.get("auth") in ("auto", "digest", "basic", "none") else "auto",
           "snap_tpl": _s(c.get("snap_tpl"), 500), "mjpeg_tpl": _s(c.get("mjpeg_tpl"), 500), "rtsp_tpl": _s(c.get("rtsp_tpl"), 500),
           "url": _s(c.get("url"), 500), "user": _s(c.get("user"), 60),
           "pw": oldpw.get(cid, "") if pw in (None, "") else ("" if pw == "__clear__" else str(pw))}
    if mode != "sim":
        try:
            u = cam_url(out, "snap" if mode == "snapshot" else "mjpeg")
        except (KeyError, IndexError, ValueError) as e:
            raise HTTPException(400, "%s 주소 틀에 알 수 없는 항목이 있습니다: %s (쓸 수 있는 것: {ip} {port} {ch} {ch0})" % (cid, e))
        if not u.startswith(("http://", "https://")):
            raise HTTPException(400, "%s: %s 주소가 없거나 http:// 로 시작하지 않습니다" % (cid, "스냅샷" if mode == "snapshot" else "MJPEG"))
    return out


COMMON_DIRECT = ("host", "port", "unit", "timeout", "encoding", "checksum", "cs_from", "cs_fmt", "ack")


def clean_direct(x, kind, name):
    drv = x.get("driver") if x.get("driver") in ("plc", "modbus", "tcp") else "plc"
    o = {"driver": drv, "vendor": _s(x.get("vendor"), 60) or drv}
    if drv == "plc":
        return o
    host = _s(x.get("host"), 100)
    if not host and x.get("use"):
        raise HTTPException(400, "%s: 장치 IP 주소를 입력하세요" % name)
    o.update(host=host, port=_int(x.get("port") or (502 if drv == "modbus" else 5000), name + " 포트", 1, 65535),
             timeout=max(.3, min(30.0, _num(x.get("timeout") or 2, name + " 응답 대기"))),
             encoding=x.get("encoding") if x.get("encoding") in D.ENCODINGS else ("euc-kr" if kind == "vms" else "ascii"))
    if drv == "modbus":
        o["unit"] = _int(x.get("unit") if x.get("unit") not in (None, "") else 1, name + " Unit ID", 0, 255)
        keys = ("msg_reg", "fb_reg", "text_reg") if kind == "vms" else ("down_coil", "up_coil", "lamp_coil", "up_di", "down_di", "flt_di")
        for k in keys:
            o[k] = _addr(x.get(k), name + " " + k)
        if kind == "vms":
            if o["msg_reg"] == "" and x.get("use"):
                raise HTTPException(400, "%s: 문안 번호 레지스터를 입력하세요" % name)
            o["fb_fc"] = 4 if str(x.get("fb_fc")) == "4" else 3
            o["text_len"] = _int(x.get("text_len") or 20, name + " 문안 길이", 1, 60)
        else:
            if (o["down_coil"] == "" or o["up_coil"] == "") and x.get("use"):
                raise HTTPException(400, "%s: 하강·상승 코일 주소를 입력하세요" % name)
            o["pulse_ms"] = _int(x.get("pulse_ms") or 0, name + " 펄스 시간", 0, 10000)
    else:
        o.update(checksum=x.get("checksum") if x.get("checksum") in ("none", "xor", "sum8", "sum16", "lrc") else "none",
                 cs_from="all" if x.get("cs_from") == "all" else "after_stx", cs_fmt="hex2" if x.get("cs_fmt") == "hex2" else "byte",
                 ack=_s(x.get("ack"), 60))
        tkeys = ("tpl",) if kind == "vms" else ("down_tpl", "up_tpl", "status_tpl")
        for k in tkeys:
            o[k] = _s(x.get(k), 300)
        if kind == "gate":
            o["resp_down"], o["resp_up"] = _s(x.get("resp_down"), 60), _s(x.get("resp_up"), 60)
        must = ("tpl",) if kind == "vms" else ("down_tpl", "up_tpl")
        for k in must:
            if x.get("use") and not o[k]:
                raise HTTPException(400, "%s: 명령 틀을 입력하세요" % name)
        try:
            for k in tkeys:
                if o[k]:
                    D.render(o[k], {"no": 1, "l1": "시험", "l2": "시험", "slot": 1}, o["encoding"], o["checksum"], o["cs_from"], o["cs_fmt"])
            for k in ("ack", "resp_down", "resp_up"):
                if o.get(k):
                    D.pattern(o[k], o["encoding"])
        except (ValueError, UnicodeEncodeError) as e:
            raise HTTPException(400, "%s: %s" % (name, e))
    return o


@app.post("/api/devices")
async def devices_save(tunnel: str, body: dict, u=Depends(need("관리자"))):
    t = T(tunnel)
    old = t.devcfg
    plc = clean_plc(body.get("plc", {}), old["plc"])
    oldpw = {c["id"]: c.get("pw", "") for c in old["cctv"]}
    cams, ids = [], set()
    for c in body.get("cctv", []):
        cid = _s(c.get("id"), 30)
        if not cid or cid in ids:
            raise HTTPException(400, "카메라 번호가 비었거나 겹칩니다: '%s'" % cid)
        ids.add(cid)
        cams.append(clean_cam(c, oldpw))
    v = body.get("vms", {})
    presets = []
    for pr in v.get("presets", []):
        no = int(_num(pr.get("no"), "문안 번호"))
        if any(x["no"] == no for x in presets):
            raise HTTPException(400, "문안 번호 %d가 겹칩니다" % no)
        presets.append({"no": no, "l1": _s(pr.get("l1"), 20), "l2": _s(pr.get("l2"), 20),
                        "color": pr.get("color") if pr.get("color") in ("녹", "황", "적") else "황"})
    if not presets:
        raise HTTPException(400, "VMS 문안을 하나 이상 등록하세요")
    nos = {x["no"] for x in presets}
    normal, fire = int(_num(v.get("normal"), "평상시 문안")), int(_num(v.get("fire"), "화재 문안"))
    if normal not in nos or fire not in nos:
        raise HTTPException(400, "평상시·화재 문안 번호는 등록된 문안 중에서 고르세요")
    slots = []
    for i, x in enumerate(v.get("slots", [])[:MAX_VMS]):
        name = _s(x.get("name"), 40) or "VMS-%d" % (i + 1)
        slots.append(dict({"slot": i + 1, "use": bool(x.get("use")), "name": name, "loc": _s(x.get("loc"), 60)},
                          **clean_direct(x, "vms", name)))
    gates = []
    for i, x in enumerate(body.get("gates", [])[:MAX_GATES]):
        name = _s(x.get("name"), 40) or "진입차단-%d" % (i + 1)
        gates.append(dict({"slot": i + 1, "use": bool(x.get("use")), "name": name,
                           "side": "end" if x.get("side") == "end" else "start", "fire_auto": bool(x.get("fire_auto"))},
                          **clean_direct(x, "gate", name)))
    d = {"plc": plc, "cctv": cams, "vms": {"slots": slots, "presets": presets, "normal": normal, "fire": fire}, "gates": gates}
    reconnected = t.apply_devices(d)
    t.log("설비 설정 변경" + (" · PLC 재연결 %s" % t.plc_desc() if reconnected else ""), "op", u["name"])
    return {"ok": True, "reconnected": reconnected}


# ---------- 제조사 프로필 ----------
@app.get("/api/vendors")
def vendors_list(u=Depends(need("감시"))):
    mine = store.get("vendor_profiles", {}) or {}
    return {k: [dict(p, builtin=True) for p in BUILTIN[k]] + [dict(p, builtin=False) for p in mine.get(k, [])] for k in BUILTIN}


@app.post("/api/vendors")
def vendors_save(body: dict, u=Depends(need("관리자"))):
    kind, name = body.get("kind"), _s(body.get("name"), 60)
    if kind not in BUILTIN or not name:
        raise HTTPException(400, "프로필 이름을 입력하세요")
    vals = body.get("values") or {}
    vals = {k: v for k, v in vals.items() if k not in ("pw", "id", "name", "slot", "use", "pos", "loc", "side", "fire_auto", "host", "ip")}
    mine = store.get("vendor_profiles", {}) or {}
    lst = [p for p in mine.get(kind, []) if p["name"] != name]
    lst.append({"key": "u:" + name, "name": name, "values": vals, "note": _s(body.get("note"), 300) or "내가 저장한 프로필"})
    mine[kind] = lst
    store.put("vendor_profiles", mine)
    store.event("", "시스템", "op", "제조사 프로필 저장 · %s" % name, u["name"])
    return {"ok": True, "key": "u:" + name}


@app.post("/api/vendors/delete")
def vendors_delete(body: dict, u=Depends(need("관리자"))):
    kind, key = body.get("kind"), body.get("key", "")
    mine = store.get("vendor_profiles", {}) or {}
    mine[kind] = [p for p in mine.get(kind, []) if p["key"] != key]
    store.put("vendor_profiles", mine)
    return {"ok": True}


# ---------- 연결 시험 · 명령 미리보기 ----------
@app.post("/api/devices/test")
async def devices_test(body: dict, u=Depends(need("관리자"))):
    """PLC 응답 확인. 고른 프로토콜로 관제점 전체를 한 번 읽어 본다 (쓰기는 하지 않음)."""
    t = T(body.get("tunnel") or next(iter(tunnels)))
    p = clean_plc(body, t.devcfg["plc"])
    tags = load_tags(BASE, t.c)[0]
    try:
        dev = make_driver(p, tags, BASE)
    except Exception as e:
        return {"ok": False, "msg": "설정 오류: %s" % e}
    t0 = time.monotonic()
    try:
        v = await asyncio.wait_for(dev.read_all(), p["timeout"] + 5)
        return {"ok": True, "msg": "응답 정상 · 관제점 %d점 읽음 (%d ms)" % (len(v), (time.monotonic() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "msg": "응답 없음: %s" % (str(e) or type(e).__name__)}
    finally:
        if p["protocol"] != "modbus":
            dev.close()


@app.post("/api/devices/probe")
async def devices_probe(body: dict, u=Depends(need("관리자"))):
    """장치별 연결 시험 / 명령 미리보기. 실제 제어 명령은 보내지 않는다(상태 조회만)."""
    t = T(body.get("tunnel"))
    kind, action, x = body.get("kind"), body.get("action"), body.get("cfg") or {}
    if kind == "cctv":
        oldpw = {c["id"]: c.get("pw", "") for c in t.devcfg["cctv"]}
        c = clean_cam(dict(x, mode="snapshot"), oldpw)
        url = cam_url(c, "snap")
        try:
            data, ct = await asyncio.to_thread(_fetch, url, c["user"], c["pw"], c["auth"])
        except Exception as e:
            return {"ok": False, "msg": "영상 수신 실패: %s" % (str(e) or type(e).__name__), "url": url}
        if not ct.startswith("image/"):
            return {"ok": False, "msg": "응답이 이미지가 아닙니다 (%s). 주소를 확인하세요" % ct, "url": url}
        import base64
        return {"ok": True, "msg": "정지영상 수신 정상 (%d KB)" % (len(data) // 1024), "url": url,
                "img": "data:%s;base64,%s" % (ct.split(";")[0], base64.b64encode(data).decode())}
    name = _s(x.get("name"), 40) or kind
    c = clean_direct(dict(x, use=True), kind, name)
    if action == "preview":
        if c["driver"] != "tcp":
            return {"ok": True, "frames": []}
        out = []
        keys = [("tpl", "문안 표출 (문안 %s번)")] if kind == "vms" else [("down_tpl", "하강"), ("up_tpl", "상승"), ("status_tpl", "상태 조회")]
        pre = t.devcfg["vms"]["presets"]
        no = int(body.get("no") or (pre[0]["no"] if pre else 1))
        pr = next((p for p in pre if p["no"] == no), {"l1": "", "l2": ""})
        for k, label in keys:
            if c.get(k):
                b = D.render(c[k], {"no": no, "l1": pr["l1"], "l2": pr["l2"], "slot": x.get("slot", 1)},
                             c["encoding"], c["checksum"], c["cs_from"], c["cs_fmt"])
                out.append({"label": label % no if "%s" in label else label, "hex": D.hexdump(b),
                            "text": b.decode("latin-1").encode("unicode_escape").decode()})
        if c.get("ack"):
            out.append({"label": "기대 응답(확인)", "hex": D.hexdump(D.pattern(c["ack"], c["encoding"])), "text": c["ack"]})
        return {"ok": True, "frames": out}
    # test
    t0 = time.monotonic()
    try:
        if c["driver"] == "plc":
            return {"ok": t.comm, "msg": "PLC 경유 · " + ("RTU 통신 정상" if t.comm else "RTU 통신 두절")}
        if c["driver"] == "modbus":
            if kind == "vms":
                a = D.mb_addr(c["fb_reg"]) if c["fb_reg"] != "" else D.mb_addr(c["msg_reg"])
                r = await D.mb_read(c["host"], c["port"], c["unit"], c["fb_fc"] if c["fb_reg"] != "" else 3, a, 1, c["timeout"])
                msg = "응답 정상 · 레지스터 %d = %d" % (a, r[0])
            else:
                a = D.mb_addr(c["up_di"] or c["down_di"] or "0")
                r = await D.mb_read(c["host"], c["port"], c["unit"], 2, a, 3, c["timeout"])
                msg = "응답 정상 · 입력 %d~%d = %s" % (a, a + 2, " ".join("1" if b else "0" for b in r))
        else:
            if kind == "gate" and c.get("status_tpl"):
                f = D.render(c["status_tpl"], {"slot": x.get("slot", 1)}, c["encoding"], c["checksum"], c["cs_from"], c["cs_fmt"])
                resp = await D.tcp_exchange(c["host"], c["port"], f, c["timeout"])
                msg = "상태 조회 응답: %s" % (D.hexdump(resp) or "없음")
            else:
                await D.tcp_exchange(c["host"], c["port"], b"", c["timeout"], want_reply=False)
                msg = "TCP 연결 정상 (명령은 보내지 않았습니다)"
        return {"ok": True, "msg": msg + " · %d ms" % ((time.monotonic() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "msg": "실패: %s" % (str(e) or type(e).__name__)}


@app.post("/api/control")
def control_save(body: dict, u=Depends(need("관리자"))):
    new = {}
    for k, typ in CTL_KEYS.items():
        if k not in body:
            continue
        v = body[k]
        new[k] = [_num(x, k) for x in v] if typ is list else _num(v, k)
    if "co_steps" in new and (len(new["co_steps"]) != 3 or new["co_steps"] != sorted(new["co_steps"])):
        raise HTTPException(400, "CO 단계값 3개를 작은 값부터 입력하세요")
    if "light_lum" in new and (len(new["light_lum"]) != 3 or new["light_lum"] != sorted(new["light_lum"], reverse=True)):
        raise HTTPException(400, "조명 휘도 기준 3개를 큰 값부터 입력하세요")
    if "late_night" in new:
        new["late_night"] = [int(x) % 24 for x in new["late_night"]][:2]
    CFG["control"].update(new)
    store.put("control", {k: CFG["control"][k] for k in CTL_KEYS if k in CFG["control"]})
    store.event("", "시스템", "op", "제어 기준값 변경", u["name"])
    return {"ok": True}


def _fetch(url, user, pw, auth="auto"):
    import urllib.request
    handlers = []
    if user and auth != "none":
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, url, user, pw)
        if auth in ("auto", "digest"):
            handlers.append(urllib.request.HTTPDigestAuthHandler(mgr))
        if auth in ("auto", "basic"):
            handlers.append(urllib.request.HTTPBasicAuthHandler(mgr))
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}), *handlers)
    with op.open(url, timeout=4) as r:
        return r.read(5_000_000), r.headers.get("Content-Type", "image/jpeg")


@app.get("/api/cctv/snap")
async def cctv_snap(tunnel: str, id: str, u=Depends(need("감시"))):
    t = T(tunnel)
    cam = next((c for c in t.devcfg["cctv"] if c["id"] == id), None)
    if not cam:
        raise HTTPException(404, "카메라를 찾을 수 없습니다")
    if cam["mode"] != "snapshot":
        raise HTTPException(400, "스냅샷 방식 카메라가 아닙니다")
    try:
        data, ct = await asyncio.to_thread(_fetch, cam_url(cam, "snap"), cam.get("user", ""), cam.get("pw", ""), cam.get("auth", "auto"))
    except Exception as e:
        raise HTTPException(502, "영상 수신 실패: %s" % (str(e) or type(e).__name__))
    return Response(data, media_type=ct if ct.startswith("image/") else "image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/report")
def report(tunnel: str, u=Depends(need("감시"))):
    t = T(tunnel)
    s = t.state or {}
    day = (s.get("site") or "")[:10]
    return {"tunnel": t.name, "day": day, "kwh": s.get("kwhDay"), "peak": s.get("peak"), "stageChg": s.get("stageChg"),
            "fans": [{"id": f["id"], "hrs": f["hrs"]} for f in s.get("fans", [])],
            "events": store.events_day(t.name, day)}


def main():
    uvicorn.run(app, host="0.0.0.0", port=CFG.get("http_port", 8080), log_level="warning")


if __name__ == "__main__":
    main()
