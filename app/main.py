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
from .modbus_io import Device, Link
from .tagmap import FEEDER_USE, MAX_GATES, MAX_VMS, STAGES, display_addr, parse_rows, read_table_file, reset_tags, save_tags, to_xlsx
from .tunnel import Alarms, Tunnel

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
tunnels = {t["key"]: Tunnel(t, CFG["control"], CFG.get("clock", "real"), store, alarms, BASE) for t in CFG["tunnels"]}
SIM_ON = CFG.get("simulator", {}).get("embedded", False)
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
            "control": CFG["control"], "maxVms": MAX_VMS, "maxGates": MAX_GATES}


def public_devices(d):
    """화면으로 보내는 설비 설정 (카메라 비밀번호는 보내지 않음)."""
    out = json.loads(json.dumps(d))
    for c in out["cctv"]:
        c["has_pw"] = bool(c.pop("pw", ""))
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
    return {"custom": t.custom, "rows": [{"tag": x["tag"], "desc": x["desc"], "type": x["type"], "addr": display_addr(x),
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
    data = to_xlsx([x for x in t.dev.tags.values() if not x["tag"].startswith("SIM.")], t.name)
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


@app.post("/api/devices")
async def devices_save(tunnel: str, body: dict, u=Depends(need("관리자"))):
    t = T(tunnel)
    old = t.devcfg
    p = body.get("plc", {})
    host = str(p.get("host", "")).strip()
    if not host:
        raise HTTPException(400, "PLC IP 주소를 입력하세요")
    port, unit = int(_num(p.get("port"), "포트")), int(_num(p.get("unit"), "Unit ID"))
    if not (1 <= port <= 65535 and 0 <= unit <= 247):
        raise HTTPException(400, "포트(1~65535)나 Unit ID(0~247) 범위를 확인하세요")
    oldpw = {c["id"]: c.get("pw", "") for c in old["cctv"]}
    cams, ids = [], set()
    for c in body.get("cctv", []):
        cid = str(c.get("id", "")).strip()
        if not cid or cid in ids:
            raise HTTPException(400, "카메라 번호가 비었거나 겹칩니다: '%s'" % cid)
        ids.add(cid)
        mode = c.get("mode", "sim")
        if mode not in ("sim", "snapshot", "mjpeg"):
            raise HTTPException(400, "영상 방식은 모의·스냅샷·MJPEG 중 하나입니다")
        url = str(c.get("url", "")).strip()
        if mode != "sim" and not url.startswith(("http://", "https://")):
            raise HTTPException(400, "%s: 영상 주소는 http:// 로 시작해야 합니다" % cid)
        pos = _num(c.get("pos", 0), cid + " 위치")
        pw = c.get("pw")
        cams.append({"id": cid, "name": str(c.get("name", "")).strip() or cid, "pos": min(1, max(0, pos)),
                     "mode": mode, "url": url, "user": str(c.get("user", "")).strip(),
                     "pw": oldpw.get(cid, "") if pw in (None, "") else ("" if pw == "__clear__" else str(pw))})
    v = body.get("vms", {})
    presets = []
    for pr in v.get("presets", []):
        no = int(_num(pr.get("no"), "문안 번호"))
        if any(x["no"] == no for x in presets):
            raise HTTPException(400, "문안 번호 %d가 겹칩니다" % no)
        presets.append({"no": no, "l1": str(pr.get("l1", ""))[:20], "l2": str(pr.get("l2", ""))[:20],
                        "color": pr.get("color") if pr.get("color") in ("녹", "황", "적") else "황"})
    if not presets:
        raise HTTPException(400, "VMS 문안을 하나 이상 등록하세요")
    nos = {x["no"] for x in presets}
    normal, fire = int(_num(v.get("normal"), "평상시 문안")), int(_num(v.get("fire"), "화재 문안"))
    if normal not in nos or fire not in nos:
        raise HTTPException(400, "평상시·화재 문안 번호는 등록된 문안 중에서 고르세요")
    slots = [{"slot": i + 1, "use": bool(x.get("use")), "name": str(x.get("name", "")).strip() or "VMS-%d" % (i + 1),
              "loc": str(x.get("loc", "")).strip()} for i, x in enumerate(v.get("slots", [])[:MAX_VMS])]
    gates = [{"slot": i + 1, "use": bool(x.get("use")), "name": str(x.get("name", "")).strip() or "진입차단-%d" % (i + 1),
              "side": "end" if x.get("side") == "end" else "start", "fire_auto": bool(x.get("fire_auto"))}
             for i, x in enumerate(body.get("gates", [])[:MAX_GATES])]
    d = {"plc": {"host": host, "port": port, "unit": unit}, "cctv": cams,
         "vms": {"slots": slots, "presets": presets, "normal": normal, "fire": fire}, "gates": gates}
    reconnected = t.apply_devices(d)
    t.log("설비 설정 변경" + (" · PLC 재연결 %s" % t.plc_desc() if reconnected else ""), "op", u["name"])
    return {"ok": True, "reconnected": reconnected}


@app.post("/api/devices/test")
async def devices_test(body: dict, u=Depends(need("관리자"))):
    """저장 전에 PLC 응답을 확인한다 (DI 0~4 읽기)."""
    host = str(body.get("host", "")).strip()
    port, unit = int(_num(body.get("port"), "포트")), int(_num(body.get("unit"), "Unit ID"))
    dev = Device(host, port, unit, [{"tag": "T", "type": "DI", "addr": 0, "scale": 1, "unit": "", "dtype": "bool"}])
    dev.link = Link(host, port)   # 운영 연결과 분리
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(dev.read_all(), 5)
        return {"ok": True, "msg": "응답 정상 (%d ms)" % ((time.monotonic() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "msg": "응답 없음: %s" % (str(e) or type(e).__name__)}
    finally:
        if dev.link.client:
            dev.link.client.close()


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


def _fetch(url, user, pw):
    import urllib.request
    handlers = []
    if user:
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, url, user, pw)
        handlers += [urllib.request.HTTPDigestAuthHandler(mgr), urllib.request.HTTPBasicAuthHandler(mgr)]
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
        data, ct = await asyncio.to_thread(_fetch, cam["url"], cam["user"], cam["pw"])
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
