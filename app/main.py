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
from .tagmap import FEEDER_USE, STAGES, display_addr, parse_rows, read_table_file, reset_tags, save_tags, to_xlsx
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
                         "host": t.c["host"], "port": t.c["port"], "unit": t.c["unit"]} for t in tunnels.values()]}


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
