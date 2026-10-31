"""터널 한 곳의 상태 해석 · 자동제어 · 경보.

역할 분담
  PLC(RTU-E1): 인터락, 정↔역 전환 대기, 차단기 동작 — 최종 안전 기능
  이 서버    : 자동운전(휘도 연동 조명, CO·VI 연동 제트팬), 화재 시나리오, 경보, 이력
"""
import datetime as dt
import logging

import asyncio
import copy
import time

from . import drivers as D
from .protocols import PROTOCOLS, make_driver
from .tagmap import MAX_GATES, MAX_VMS, STAGES, fan_ids, load_tags

log = logging.getLogger("tunnel")
STAGE_NAMES = [s["k"] for s in STAGES]


VMS_PRESETS = [
    {"no": 1, "l1": "터널 안 차간거리 유지", "l2": "전조등을 켜십시오", "color": "녹"},
    {"no": 2, "l1": "터널 내 화재 발생", "l2": "진입 금지", "color": "적"},
    {"no": 3, "l1": "터널 내 사고 발생", "l2": "서행 하십시오", "color": "황"},
    {"no": 4, "l1": "터널 내 정체", "l2": "안전거리 확보", "color": "황"},
    {"no": 5, "l1": "터널 점검 작업 중", "l2": "차로 통제", "color": "황"},
]


def default_devices(cfg):
    """설비 설정 기본값. 관리자가 화면에서 바꾸면 DB에 저장된 값이 우선한다."""
    return {
        "plc": {"protocol": "modbus", "transport": "tcp", "host": cfg["host"], "port": cfg["port"], "unit": cfg["unit"],
                "vendor": "generic", "word_order": "high", "addr_offset": 0, "timeout": 2, "block": 100},
        "cctv": [
            {"id": "CAM-01", "name": "시점 갱구 외부", "pos": 0.0, "mode": "sim", "url": "", "user": "", "pw": ""},
            {"id": "CAM-02", "name": "터널 내 1", "pos": 0.3, "mode": "sim", "url": "", "user": "", "pw": ""},
            {"id": "CAM-03", "name": "터널 내 2", "pos": 0.6, "mode": "sim", "url": "", "user": "", "pw": ""},
            {"id": "CAM-04", "name": "종점 갱구", "pos": 0.97, "mode": "sim", "url": "", "user": "", "pw": ""},
        ],
        "vms": {
            "slots": [{"slot": i + 1, "use": i == 0, "name": "VMS-%d" % (i + 1),
                       "loc": "시점 진입 전 300 m" if i == 0 else ""} for i in range(MAX_VMS)],
            "presets": copy.deepcopy(VMS_PRESETS), "normal": 1, "fire": 2,
        },
        "gates": [{"slot": i + 1, "use": i == 0, "name": "진입차단-%d" % (i + 1),
                   "side": "start", "fire_auto": True} for i in range(MAX_GATES)],
    }


def plc_opt(p):
    """연결에 영향을 주는 PLC 설정 (제조사 이름 제외)."""
    return {k: v for k, v in p.items() if k not in ("vendor",)}


def cam_url(c, kind="snap"):
    """카메라 설정 → 실제 주소. 제조사 주소 틀({ip} {port} {ch} {ch0})을 채운다."""
    tpl = c.get(kind + "_tpl") or ""
    if not tpl:
        return c.get("url", "") if kind == "snap" or c.get("mode") == "mjpeg" else ""
    ch = str(c.get("ch", "1") or "1")
    try:
        ch0 = str(int(ch) - 1)
    except ValueError:
        ch0 = ch
    return tpl.format(ip=c.get("ip", ""), port=c.get("port", 80), ch=ch, ch0=ch0)


def merge_devices(base, saved):
    d = copy.deepcopy(base)
    if not saved:
        return d
    for k in ("plc", "cctv", "gates"):
        if k in saved:
            d[k] = saved[k]
    if "vms" in saved:
        d["vms"].update(saved["vms"])
    return d


class Alarms:
    def __init__(self, store):
        self.store, self.items, self.seq = store, [], 0

    def set(self, tn, key, cond, lvl, msg, site, logf):
        k = tn["key"] + ":" + key
        a = next((x for x in self.items if x["k"] == k and x["active"]), None)
        if cond and not a:
            aid = self.store.alarm_open(k, tn["name"], lvl, msg, site)
            self.items.insert(0, {"id": aid, "k": k, "tn": tn["name"], "tkey": tn["key"], "lvl": lvl, "msg": msg,
                                  "t": site, "ack": False, "active": True})
            logf("경보 발생 · " + msg, "alarm")
        elif not cond and a:
            a["active"] = False
            self.store.alarm_close(a["id"], site)
            logf("경보 복귀 · " + msg, "sys")
        self.items = [x for x in self.items if x["active"] or not x["ack"]]

    def ack(self, aid, user, site):
        hit = []
        for a in self.items:
            if (aid is None or a["id"] == aid) and not a["ack"]:
                a["ack"] = True
                self.store.alarm_ack(a["id"], user, site)
                hit.append(a)
        self.items = [x for x in self.items if x["active"] or not x["ack"]]
        return hit

    def snapshot(self):
        return [{k: a[k] for k in ("id", "tn", "tkey", "lvl", "msg", "t", "ack", "active")} for a in self.items]


class Tunnel:
    def __init__(self, cfg, ctl, clock, store, alarms, base):
        self.c, self.ctl, self.clock, self.store, self.alarms, self.base = cfg, ctl, clock, store, alarms, base
        self.key, self.name = cfg["key"], cfg["name"]
        self.devcfg = merge_devices(default_devices(cfg), store.get(cfg["key"] + ".devices"))
        tags, self.custom = load_tags(base, cfg)
        self.dev = make_driver(self.devcfg["plc"], tags, base)
        self.ext, self.ext_t = {}, {}        # PLC를 거치지 않는 장치(VMS·차단기 직접 연결) 상태
        self.fan_ids = fan_ids(cfg["fans"])
        n = len(self.fan_ids)
        self.fan_pos = cfg.get("fan_pos") or [round(.12 + .76 * i / max(1, n - 1), 3) for i in range(n)]
        self.v, self.comm, self.fails, self.state = {}, False, 0, None
        self.light_auto = store.get(self.key + ".light_auto", True)
        self.fan_auto = store.get(self.key + ".fan_auto", True)
        self.lvl, self.fire_active = 0, False
        d = store.get(self.key + ".day", {})
        self.day_id, self.kwh0, self.peak, self.stage_chg = d.get("id"), d.get("kwh0"), d.get("peak", 0), d.get("chg", 0)
        self.last_hist = None

    def apply_devices(self, d):
        """설비 설정 저장. PLC 주소가 바뀌면 새로 연결한다."""
        old = self.devcfg["plc"]
        self.devcfg = d
        self.store.put(self.key + ".devices", d)
        p = d["plc"]
        self.ext, self.ext_t = {}, {}
        if plc_opt(old) != plc_opt(p):
            self.dev.close()
            self.dev = make_driver(p, load_tags(self.base, self.c)[0], self.base)
            self.comm, self.fails = False, 0
            return True
        return False

    def plc_desc(self):
        p = self.devcfg["plc"]
        proto = p.get("protocol", "modbus")
        if proto == "modbus" and str(p.get("transport", "tcp")).endswith("_serial"):
            return "Modbus %s %s %s Unit %s" % ("RTU" if p["transport"].startswith("rtu") else "ASCII", p.get("serial_port"), p.get("baud"), p["unit"])
        if proto == "modbus":
            return "Modbus%s %s:%s Unit %s" % ({"rtu_tcp": " RTU over TCP", "ascii_tcp": " ASCII over TCP"}.get(p.get("transport"), " TCP"), p["host"], p["port"], p["unit"])
        return "%s %s:%s" % (PROTOCOLS.get(proto, proto), p["host"], p["port"])

    def reload_tags(self):
        tags, self.custom = load_tags(self.base, self.c)
        self.dev.set_tags(tags)

    # ----- 시각 -----
    def site_time(self):
        if self.clock == "plc" and "SIM.MINUTE" in self.v:
            today = dt.date.today() + dt.timedelta(days=int(self.v.get("SIM.DAY", 0)))
            m = int(self.v["SIM.MINUTE"])
            return dt.datetime.combine(today, dt.time(m // 60 % 24, m % 60))
        return dt.datetime.now().replace(second=0, microsecond=0)

    def site_str(self):
        return self.site_time().strftime("%Y-%m-%d %H:%M")

    def log(self, msg, kind="sys", user=""):
        self.store.event(self.site_str(), self.name, kind, msg, user)

    def g(self, tag, default=0):
        return self.v.get(tag, default)

    # ----- 주기 처리 -----
    async def cycle(self):
        try:
            self.v = await self.dev.read_all()
            if not self.comm:
                self.log("RTU 통신 정상 (%s)" % self.plc_desc())
            self.comm, self.fails = True, 0
        except Exception as e:
            self.fails += 1
            if self.fails >= 3 and self.comm:
                self.comm = False
                log.warning("%s 통신 두절: %s", self.name, e)
            if self.fails >= 3:
                self.alarms.set(self.c, "comm", True, "중", "RTU 통신 두절", self.site_str(), self.log)
                if self.state:
                    self.state["comm"] = False
            return
        self.alarms.set(self.c, "comm", False, "중", "RTU 통신 두절", self.site_str(), self.log)
        await self.poll_ext()
        self.derive()
        try:
            await self.control()
        except Exception as e:
            log.warning("%s 제어 오류: %s", self.name, e)
        self.check_alarms()
        self.history()

    def derive(self):
        g = self.g
        kepco = not g("HV-1.UVR", False)
        br = {"HV-1": bool(g("HV-1.VCB", True))}
        for f in self.c["feeders"]:
            br[f] = bool(g(f + ".ST", True))
        grid = kepco and br["HV-1"]
        stage = next((i for i in range(len(STAGES)) if g("LT.ST%d_FB" % (i + 1), False)), None)
        cmd_stage = next((i for i in range(len(STAGES)) if g("LT.ST%d_CMD" % (i + 1), False)), None)
        st = STAGES[stage] if stage is not None else {"ent": 0, "base": 0}
        fans = []
        for i, fid in enumerate(self.fan_ids):
            fw, rv = g(fid + ".FWD_CMD", False), g(fid + ".REV_CMD", False)
            fans.append({"id": fid, "pos": self.fan_pos[i], "cmd": 1 if fw and not rv else -1 if rv and not fw else 0,
                         "st": 1 if g(fid + ".FWD", False) else -1 if g(fid + ".REV", False) else 0,
                         "fault": bool(g(fid + ".FLT", False)), "wait": bool(g(fid + ".WAIT", False)),
                         "rem": bool(g(fid + ".REM", True)), "amp": round(g(fid + ".A", 0), 1), "hrs": round(g(fid + ".HRS", 0), 1)})
        evac = "피난유도" if g("EV.GUIDE", False) else "점멸" if g("EV.BLINK", False) else "상시"
        fpos = g("FD.POS", 0)
        fire = {"x": fpos / 1000} if fpos > 0 or any(g("FD.Z%d" % z, False) for z in range(1, 5)) else None
        if fire and fpos <= 0:
            z = next(z for z in range(1, 5) if g("FD.Z%d" % z, False))
            fire["x"] = (z - .5) / 4
        gates = []
        for gc in self.devcfg["gates"]:
            if not gc.get("use"):
                continue
            n = "GATE%d" % gc["slot"]
            if gc.get("driver", "plc") == "plc":
                up, down, mv = bool(g(n + ".UP", True)), bool(g(n + ".DOWN", False)), bool(g(n + ".MOVE", False))
                flt, lamp, err = bool(g(n + ".FLT", False)), bool(g(n + ".LAMP", False)), ""
            else:
                e = self.ext.get(("gate", gc["slot"]), {})
                up, down, mv, lamp = e.get("up", True), e.get("down", False), False, e.get("lamp", False)
                err = e.get("err", "")
                flt = bool(e.get("flt")) or bool(err)
            gates.append({"slot": gc["slot"], "name": gc["name"], "side": gc.get("side", "start"), "driver": gc.get("driver", "plc"),
                          "st": "고장" if flt else "동작 중" if mv else "차단" if down else "개방" if up else "중간",
                          "down": down, "fault": flt, "lamp": lamp, "err": err})
        vms = []
        pre = {p["no"]: p for p in self.devcfg["vms"]["presets"]}
        for vc in self.devcfg["vms"]["slots"]:
            if not vc.get("use"):
                continue
            n = "VMS%d" % vc["slot"]
            if vc.get("driver", "plc") == "plc":
                cmd_no, fb, flt, err = int(g(n + ".MSG", 0)), int(g(n + ".FB", 0)), bool(g(n + ".FLT", False)), ""
            else:
                e = self.ext.get(("vms", vc["slot"]), {})
                cmd_no, fb, err = e.get("cmd", 0), e.get("fb", 0), e.get("err", "")
                flt = bool(err)
            vms.append({"slot": vc["slot"], "name": vc["name"], "loc": vc.get("loc", ""), "cmd": cmd_no, "fb": fb,
                        "msg": pre.get(fb), "fault": flt, "driver": vc.get("driver", "plc"), "err": err})
        ups_on = bool(g("UPS.RUN", True))
        kw = g("HV-1.KW", 0)
        kwh = g("HV-1.KWH", 0)
        sd = self.site_time()
        if self.day_id != sd.strftime("%Y-%m-%d") or self.kwh0 is None:
            if self.day_id is not None:
                self.log("일 마감 · 전력량 %.1f kWh, 최대수요 %.1f kW" % (kwh - (self.kwh0 or kwh), self.peak))
            self.day_id, self.kwh0, self.peak, self.stage_chg = sd.strftime("%Y-%m-%d"), kwh, 0, 0
            self.save_day()
        if kw > self.peak:
            self.peak = kw
        self.state = {
            "key": self.key, "comm": True, "site": sd.strftime("%Y-%m-%d %H:%M"),
            "lightAuto": self.light_auto, "fanAuto": self.fan_auto,
            "stage": STAGE_NAMES[stage] if stage is not None else "소등",
            "cmdStage": STAGE_NAMES[cmd_stage] if cmd_stage is not None else None,
            "lum": round(g("LT.L20", 0)), "fans": fans, "evac": evac, "fire": fire,
            "co": round(g("ENV.CO1", 0), 1), "vi": g("ENV.VI1", 0), "wind": round(g("ENV.WS", 0), 1),
            "tr": g("ENV.TRAFFIC", 0) / 1800, "kepco": kepco, "br": br,
            "ups": {"c": self.c["ups_kva"], "batt": round(g("UPS.BATT", 0)), "on": ups_on},
            "out": {"ent": st["ent"] if grid and br.get("LV-102", True) else 0,
                    "base": st["base"] if grid and br.get("LV-101", True) else 0,
                    "emg": ups_on and not (grid and br.get("LV-101", True))},
            "kw": round(kw, 1), "fk": {f: round(g(f + ".KW", 0), 1) for f in self.c["feeders"]},
            "fa": {f: round(g(f + ".A", 0), 1) for f in self.c["feeders"]},
            "hv": {"v": round(g("HV-1.V_RS", 0), 2), "a": round(g("HV-1.A_R", 0), 1), "pf": round(g("HV-1.PF", 0), 3),
                   "hz": round(g("HV-1.HZ", 0), 1), "ptr": round(g("PTR-1.TEMP", 0), 1)},
            "kwhTot": round(kwh), "kwhDay": round(kwh - self.kwh0, 1), "peak": round(self.peak, 1),
            "stageChg": self.stage_chg, "gates": gates, "vms": vms, "speed": int(g("SIM.SPEED", 0)) if "SIM.SPEED" in self.v else None,
        }

    def save_day(self):
        self.store.put(self.key + ".day", {"id": self.day_id, "kwh0": self.kwh0, "peak": self.peak, "chg": self.stage_chg})

    # ----- 쓰기 -----
    async def w(self, tag, val):
        await self.dev.write(tag, val)
        self.v[tag] = val

    async def write_stage(self, idx):
        for j in range(len(STAGES)):
            await self.w("LT.ST%d_CMD" % (j + 1), j == idx)

    async def write_fan(self, fid, cmd):
        await self.w(fid + ".FWD_CMD", cmd == 1)
        await self.w(fid + ".REV_CMD", cmd == -1)

    async def write_evac(self, mode, split=0):
        await self.w("EV.BLINK", mode == "점멸")
        await self.w("EV.GUIDE", mode == "피난유도")
        if "EV.SPLIT" in self.dev.tags:
            await self.w("EV.SPLIT", int(split * 1000))

    # ----- 직접 연결 장치 (제조사 설정) -----
    def _vmsc(self, slot):
        return next(v for v in self.devcfg["vms"]["slots"] if v["slot"] == slot)

    def _gatec(self, slot):
        return next(x for x in self.devcfg["gates"] if x["slot"] == slot)

    @staticmethod
    def _tm(c):
        return float(c.get("timeout") or 2)

    def _frame(self, c, tpl, values):
        return D.render(tpl, values, c.get("encoding", "euc-kr"), c.get("checksum", "none"),
                        c.get("cs_from", "after_stx"), c.get("cs_fmt", "byte"))

    async def _tcp_cmd(self, c, data):
        resp = await D.tcp_exchange(c["host"], c["port"], data, self._tm(c), want_reply=bool(c.get("ack")))
        ack = D.pattern(c.get("ack", ""), c.get("encoding", "ascii"))
        if ack and ack not in resp:
            raise IOError("응답이 확인 문자와 다릅니다 (받음: %s)" % (D.hexdump(resp) or "없음"))
        return resp

    async def vms_show(self, slot, no):
        vc = self._vmsc(slot)
        drv = vc.get("driver", "plc")
        if drv == "plc":
            await self.w("VMS%d.MSG" % slot, no)
            return
        pre = next((p for p in self.devcfg["vms"]["presets"] if p["no"] == no), {"l1": "", "l2": ""})
        e = self.ext.setdefault(("vms", slot), {})
        e["cmd"] = no
        try:
            if drv == "modbus":
                h, pt, u, tm = vc["host"], vc["port"], vc["unit"], self._tm(vc)
                tr = D.mb_addr(vc.get("text_reg", ""))
                if tr is not None:
                    n = int(vc.get("text_len") or 20)
                    await D.mb_write_regs(h, pt, u, tr, D.text_regs(pre["l1"], n, vc.get("encoding")) +
                                          D.text_regs(pre["l2"], n, vc.get("encoding")), tm)
                await D.mb_write_reg(h, pt, u, D.mb_addr(vc["msg_reg"]), no, tm)
                if D.mb_addr(vc.get("fb_reg", "")) is None:
                    e["fb"] = no
            else:
                await self._tcp_cmd(vc, self._frame(vc, vc["tpl"], {"no": no, "l1": pre["l1"], "l2": pre["l2"], "slot": slot}))
                e["fb"] = no
            e["err"] = ""
        except Exception as ex:
            e["err"] = str(ex) or type(ex).__name__
            raise RuntimeError("%s 명령 실패: %s" % (vc["name"], e["err"]))

    async def gate_cmd(self, slot, down):
        gc = self._gatec(slot)
        drv = gc.get("driver", "plc")
        n = "GATE%d" % slot
        if drv == "plc":
            if down:
                await self.w(n + ".LAMP", True)
                await self.w(n + ".DOWN_CMD", True)
            else:
                await self.w(n + ".UP_CMD", True)
                await self.w(n + ".LAMP", False)
            return
        e = self.ext.setdefault(("gate", slot), {})
        try:
            if drv == "modbus":
                h, pt, u, tm = gc["host"], gc["port"], gc["unit"], self._tm(gc)
                lamp = D.mb_addr(gc.get("lamp_coil", ""))
                if lamp is not None and down:
                    await D.mb_write_coil(h, pt, u, lamp, True, tm)
                coil, other = D.mb_addr(gc["down_coil" if down else "up_coil"]), D.mb_addr(gc["up_coil" if down else "down_coil"])
                pulse = int(gc.get("pulse_ms") or 0)
                if not pulse and other is not None:
                    await D.mb_write_coil(h, pt, u, other, False, tm)
                await D.mb_write_coil(h, pt, u, coil, True, tm)
                if pulse:
                    await asyncio.sleep(pulse / 1000)
                    await D.mb_write_coil(h, pt, u, coil, False, tm)
                if lamp is not None and not down:
                    await D.mb_write_coil(h, pt, u, lamp, False, tm)
                if D.mb_addr(gc.get("down_di", "")) is None:
                    e.update(down=down, up=not down)
            else:
                await self._tcp_cmd(gc, self._frame(gc, gc["down_tpl" if down else "up_tpl"], {"slot": slot}))
                if not gc.get("status_tpl"):
                    e.update(down=down, up=not down)
            e["lamp"], e["err"] = down, ""
        except Exception as ex:
            e["err"] = str(ex) or type(ex).__name__
            raise RuntimeError("%s 명령 실패: %s" % (gc["name"], e["err"]))

    async def poll_ext(self):
        """직접 연결 장치 상태 읽기. Modbus는 매 주기, TCP 상태조회는 5초마다."""
        jobs = []
        now = time.monotonic()
        for vc in self.devcfg["vms"]["slots"]:
            if vc.get("use") and vc.get("driver") == "modbus" and D.mb_addr(vc.get("fb_reg", "")) is not None:
                jobs.append(self._poll_vms_mb(vc))
        for gc in self.devcfg["gates"]:
            if not gc.get("use"):
                continue
            if gc.get("driver") == "modbus" and D.mb_addr(gc.get("down_di", "")) is not None:
                jobs.append(self._poll_gate_mb(gc))
            elif gc.get("driver") == "tcp" and gc.get("status_tpl") and now - self.ext_t.get(gc["slot"], 0) > 5:
                self.ext_t[gc["slot"]] = now
                jobs.append(self._poll_gate_tcp(gc))
        if jobs:
            await asyncio.gather(*[asyncio.wait_for(j, 4) for j in jobs], return_exceptions=True)

    async def _poll_vms_mb(self, vc):
        e = self.ext.setdefault(("vms", vc["slot"]), {})
        try:
            r = await D.mb_read(vc["host"], vc["port"], vc["unit"], vc.get("fb_fc", 3), D.mb_addr(vc["fb_reg"]), 1, self._tm(vc))
            e["fb"], e["err"] = int(r[0]), ""
            e.setdefault("cmd", e["fb"])
        except Exception as ex:
            e["err"] = "상태 읽기 실패: %s" % (str(ex) or type(ex).__name__)

    async def _poll_gate_mb(self, gc):
        e = self.ext.setdefault(("gate", gc["slot"]), {})
        try:
            addrs = [D.mb_addr(gc.get(k, "")) for k in ("up_di", "down_di", "flt_di")]
            lo = min(a for a in addrs if a is not None)
            hi = max(a for a in addrs if a is not None)
            bits = await D.mb_read(gc["host"], gc["port"], gc["unit"], 2, lo, hi - lo + 1, self._tm(gc))
            get = lambda a: bool(bits[a - lo]) if a is not None else False  # noqa: E731
            e.update(up=get(addrs[0]), down=get(addrs[1]), flt=get(addrs[2]), err="")
        except Exception as ex:
            e["err"] = "상태 읽기 실패: %s" % (str(ex) or type(ex).__name__)

    async def _poll_gate_tcp(self, gc):
        e = self.ext.setdefault(("gate", gc["slot"]), {})
        try:
            resp = await D.tcp_exchange(gc["host"], gc["port"], self._frame(gc, gc["status_tpl"], {"slot": gc["slot"]}), self._tm(gc))
            enc = gc.get("encoding", "ascii")
            dn, upp = D.pattern(gc.get("resp_down", ""), enc), D.pattern(gc.get("resp_up", ""), enc)
            if dn and dn in resp:
                e.update(down=True, up=False, err="")
            elif upp and upp in resp:
                e.update(down=False, up=True, err="")
            else:
                e["err"] = "상태 응답을 알 수 없음: %s" % (D.hexdump(resp) or "없음")
        except Exception as ex:
            e["err"] = "상태 조회 실패: %s" % (str(ex) or type(ex).__name__)

    # ----- 자동제어 -----
    def auto_stage(self, lum, hour):
        a, b, c = self.ctl["light_lum"]
        if lum >= a:
            return 0
        if lum >= b:
            return 1
        if lum >= c:
            return 2
        ln0, ln1 = self.ctl["late_night"]
        return 4 if (hour >= ln0 or hour < ln1) else 3

    async def control(self):
        s = self.state
        fire = s["fire"]
        if fire and not self.fire_active:
            await self.start_fire(fire["x"])
        elif not fire and self.fire_active:
            self.fire_active = False
            await self.write_evac("상시")
            v = self.devcfg["vms"]
            for vc in v["slots"]:
                if vc.get("use"):
                    try:
                        await self.vms_show(vc["slot"], int(v["normal"]))
                    except Exception as e:
                        self.log("VMS 평상시 문안 복귀 실패 · %s" % e, "alarm")
            if not self.fan_auto:
                for f in s["fans"]:
                    await self.write_fan(f["id"], 0)
            self.log("화재 복구 확인 · 방재 시나리오 종료, VMS 평상시 문안 복귀 (진입차단은 현장 확인 후 운영자가 개방)")
        if self.fire_active:
            return
        if self.light_auto:
            want = self.auto_stage(s["lum"], self.site_time().hour)
            if s["cmdStage"] != STAGE_NAMES[want]:
                old = s["cmdStage"] or "소등"
                await self.write_stage(want)
                self.stage_chg += 1
                self.save_day()
                self.log("조명 단계 자동 전환 · %s → %s (L20 %d cd/m²)" % (old, STAGE_NAMES[want], s["lum"]))
        if self.fan_auto:
            n = len(s["fans"])
            thr = [0] + list(self.ctl["co_steps"])
            co, vi = s["co"], s["vi"]
            L = 3 if co >= thr[3] else 2 if co >= thr[2] else 1 if co >= thr[1] else 0
            if vi >= self.ctl["vi_limit"]:
                L = max(L, 2)
            if L < self.lvl and co > thr[self.lvl] - self.ctl["co_hyst"]:
                L = self.lvl
            if L != self.lvl:
                self.log("제트팬 자동 단계 %d → %d (CO %.1f ppm, VI %.2f×10⁻³)" % (self.lvl, L, co, vi * 1000))
            self.lvl = L
            need = [0, -(-n // 3), -(-2 * n // 3), n][L]
            pool = sorted([f for f in s["fans"] if not f["fault"]], key=lambda f: (f["cmd"] != 1, f["hrs"]))
            want = {f["id"]: (1 if i < need else 0) for i, f in enumerate(pool)}
            for f in s["fans"]:
                c = want.get(f["id"], 0)
                if f["cmd"] != c:
                    await self.write_fan(f["id"], c)

    async def start_fire(self, x):
        self.fire_active = True
        await self.write_stage(0)
        for i, f in enumerate(self.state["fans"]):
            await self.write_fan(f["id"], 0 if abs(self.fan_pos[i] - x) < self.ctl["fire_fan_exclude"] else 1)
        await self.write_evac("피난유도", x)
        v = self.devcfg["vms"]
        for vc in v["slots"]:
            if vc.get("use"):
                try:
                    await self.vms_show(vc["slot"], int(v["fire"]))
                except Exception as e:
                    self.log("화재 VMS 표출 실패 · %s" % e, "alarm")
        for gc in self.devcfg["gates"]:
            if gc.get("use") and gc.get("fire_auto"):
                try:
                    await self.gate_cmd(gc["slot"], True)
                except Exception as e:
                    self.log("화재 진입차단 하강 실패 · %s" % e, "alarm")
        self.log("화재 감지 STA %s · 방재 시나리오 개시 (조명 최대, 화점 인접 제트팬 정지·상류측 정회전, 피난유도, VMS 진입금지, 진입차단 하강)"
                 % self.sta(x), "alarm")

    def sta(self, p):
        a, b = self.c["sta"]
        v = round(a + (b - a) * p)
        return "%d+%03d" % (v // 1000, v % 1000)

    # ----- 운영자 명령 -----
    async def command(self, a, args, user):
        s, uname = self.state, user["name"]
        direct = (a == "vms" and self._vmsc(int(args["slot"])).get("driver", "plc") != "plc") or \
                 (a in ("gate", "gate_reset") and self._gatec(int(args["slot"])).get("driver", "plc") != "plc")
        if not direct and (not self.comm or not s):
            raise RuntimeError("RTU와 통신이 끊겨 명령을 보낼 수 없습니다")
        s = s or {"fire": None}
        fi = lambda: s["fans"][int(args["i"])]  # noqa: E731
        if a == "light_auto":
            self.light_auto = bool(args["on"])
            self.store.put(self.key + ".light_auto", self.light_auto)
            self.log("조명 %s 전환" % ("자동" if self.light_auto else "수동"), "op", uname)
        elif a == "stage":
            if self.light_auto or self.fire_active:
                raise RuntimeError("조명이 자동(또는 화재) 운전 중입니다. 수동으로 바꾼 뒤 조작하세요")
            i = STAGE_NAMES.index(args["v"])
            await self.write_stage(i)
            self.stage_chg += 1
            self.save_day()
            self.log("조명 단계 수동 전환 → %s" % args["v"], "op", uname)
        elif a == "fan_auto":
            self.fan_auto = bool(args["on"])
            self.store.put(self.key + ".fan_auto", self.fan_auto)
            self.log("제트팬 %s 전환" % ("자동" if self.fan_auto else "수동"), "op", uname)
        elif a == "fan":
            if self.fan_auto and not self.fire_active:
                raise RuntimeError("제트팬이 자동 운전 중입니다. 수동으로 바꾼 뒤 조작하세요")
            f, v = fi(), int(args["v"])
            if not f["rem"]:
                raise RuntimeError("%s가 현장(로컬) 선택 상태입니다" % f["id"])
            await self.write_fan(f["id"], v)
            self.log("%s %s 명령" % (f["id"], {1: "정회전", -1: "역회전", 0: "정지"}[v]), "op", uname)
        elif a == "fan_reset":
            f = fi()
            await self.w(f["id"] + ".RESET", True)
            self.log("%s 고장 복귀 명령" % f["id"], "op", uname)
        elif a == "evac":
            m = args["v"]
            await self.write_evac(m, s["fire"]["x"] if s["fire"] else 0)
            self.log("유도등 %s 전환" % m, "op", uname)
        elif a == "breaker":
            b, close = args["id"], bool(args["close"])
            await self.w(b + (".CLOSE" if close else ".OPEN"), True)
            self.log("%s %s 명령" % (b, "투입" if close else "개방"), "op", uname)
        elif a == "vms":
            slot, no = int(args["slot"]), int(args["no"])
            if not any(p["no"] == no for p in self.devcfg["vms"]["presets"]):
                raise ValueError("등록되지 않은 문안 번호입니다")
            await self.vms_show(slot, no)
            self.log("%s 문안 %d번 표출 명령" % (self._vmsc(slot)["name"], no), "op", uname)
        elif a == "gate":
            slot, down = int(args["slot"]), bool(args["down"])
            if not down and s["fire"]:
                raise RuntimeError("화재 감지 중에는 진입차단을 개방할 수 없습니다. 화재 수신기 복구 후 조작하세요")
            await self.gate_cmd(slot, down)
            self.log("%s %s 명령" % (self._gatec(slot)["name"], "하강(차단)" if down else "상승(개방)"), "op", uname)
        elif a == "gate_reset":
            gc = self._gatec(int(args["slot"]))
            if gc.get("driver", "plc") == "plc":
                await self.w("GATE%d.RESET" % gc["slot"], True)
            else:
                self.ext.get(("gate", gc["slot"]), {}).update(flt=False, err="")
            self.log("진입차단-%d 고장 복귀 명령" % int(args["slot"]), "op", uname)
        elif a == "fire_reset":
            await self.w("FD.RESET", True)
            self.log("화재 수신기 복구 명령", "op", uname)
        else:
            raise ValueError("알 수 없는 명령: " + a)

    async def sim(self, a, args, user):
        if "SIM.FIRE" not in self.dev.tags:
            raise RuntimeError("모의 시험은 시뮬레이터 연결 시에만 쓸 수 있습니다")
        if a == "fire":
            await self.w("SIM.FIRE", int(float(args.get("x", .5)) * 1000))
        elif a == "fault":
            cand = [i for i, f in enumerate(self.state["fans"]) if not f["fault"]]
            run = [i for i in cand if self.state["fans"][i]["st"]]
            if cand:
                await self.w("SIM.FAULT", (run or cand)[0] + 1)
        elif a == "co":
            await self.w("SIM.CO_BOOST", 70)
        elif a == "outage":
            await self.w("SIM.KEPCO", 0 if args.get("on") else 1)
        elif a == "speed":
            await self.w("SIM.SPEED", int(args["v"]))
        else:
            raise ValueError("알 수 없는 모의 명령")
        self.log("모의 시험 · %s" % {"fire": "화재 발생", "fault": "제트팬 고장", "co": "CO 급상승",
                                    "outage": "한전 정전" if args.get("on") else "한전 복전", "speed": "배속 %s" % args.get("v")}[a],
                 "sim", user["name"])

    # ----- 경보 / 이력 -----
    def check_alarms(self):
        s, C, site = self.state, self.ctl, self.site_str()
        A = lambda k, c, l, m: self.alarms.set(self.c, k, c, l, m, site, self.log)  # noqa: E731
        grid = s["kepco"] and s["br"]["HV-1"]
        for f in s["fans"]:
            A("jf" + f["id"], f["fault"], "중", f["id"] + " 과부하 트립 (고장)")
        A("fanpwr", not (grid and s["br"].get("LV-103", True)) and any(f["cmd"] for f in s["fans"]), "중", "제트팬 MCC 전원 상실 — 운전 불가")
        A("light", grid and not (s["br"].get("LV-101", True) and s["br"].get("LV-102", True)), "경", "조명 간선 차단기 개방 — 일부 조명 소등")
        A("co1", C["alarm_co_warn"] <= s["co"] < C["alarm_co_crit"], "경", "CO 농도 상승 (%d ppm 이상)" % C["alarm_co_warn"])
        A("co2", s["co"] >= C["alarm_co_crit"], "중", "CO 농도 위험 (%d ppm 이상)" % C["alarm_co_crit"])
        A("vi", s["vi"] >= C["alarm_vi_warn"], "경", "가시도 저하 (VI %.0f×10⁻³ m⁻¹ 이상)" % (C["alarm_vi_warn"] * 1000))
        A("kepco", not s["kepco"], "중", "한전 수전 정전 — UPS 축전지 운전")
        A("vcb", s["kepco"] and not s["br"]["HV-1"], "중", "수전 VCB(HV-1) 개방")
        A("batt", s["ups"]["on"] and s["ups"]["batt"] < C["alarm_batt_low"], "경", "UPS 축전지 잔량 %d%% 미만" % C["alarm_batt_low"])
        A("upsoff", not s["ups"]["on"], "중", "UPS 정지 — 유도등·RTU 전원 상실")
        A("fire", bool(s["fire"]), "중", "화재 감지 — 방재 시나리오 운전 중")
        A("ocr", bool(self.g("HV-1.OCR", False) or self.g("HV-1.OCGR", False)), "중", "수전 보호계전기 동작 (OCR/OCGR)")
        A("ptr", bool(self.g("PTR-1.TALM", False)), "경", "PTR-1 온도 경보")
        for gt in s["gates"]:
            A("gate%d" % gt["slot"], gt["fault"], "중", gt["name"] + (" 통신 이상" if gt["err"] else " 고장"))
            A("gdown%d" % gt["slot"], gt["down"] and not s["fire"], "경", gt["name"] + " 차단 중 — 터널 진입 통제")
        for vm in s["vms"]:
            A("vms%d" % vm["slot"], vm["fault"], "경", vm["name"] + " 고장·통신이상")
        for f in self.c["feeders"]:
            A("trip" + f, bool(self.g(f + ".TRIP", False)), "중", f + " 트립")

    def history(self):
        m = self.state["site"]
        if m != self.last_hist:
            self.last_hist = m
            s = self.state
            self.store.history_add(m, self.key, s["kw"], s["co"], s["vi"], s["lum"],
                                   {"st": [f["st"] for f in s["fans"]], "stage": s["stage"]})
            self.save_day()
