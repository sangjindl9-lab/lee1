"""터널 한 곳의 상태 해석 · 자동제어 · 경보.

역할 분담
  PLC(RTU-E1): 인터락, 정↔역 전환 대기, 차단기 동작 — 최종 안전 기능
  이 서버    : 자동운전(휘도 연동 조명, CO·VI 연동 제트팬), 화재 시나리오, 경보, 이력
"""
import datetime as dt
import logging

from .modbus_io import Device
from .tagmap import STAGES, fan_ids, load_tags

log = logging.getLogger("tunnel")
STAGE_NAMES = [s["k"] for s in STAGES]


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
        tags, self.custom = load_tags(base, cfg)
        self.dev = Device(cfg["host"], cfg["port"], cfg["unit"], tags)
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
                self.log("RTU 통신 정상 (%s:%d Unit %d)" % (self.c["host"], self.c["port"], self.c["unit"]))
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
            "stageChg": self.stage_chg, "speed": int(g("SIM.SPEED", 0)) if "SIM.SPEED" in self.v else None,
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
            if not self.fan_auto:
                for f in s["fans"]:
                    await self.write_fan(f["id"], 0)
            self.log("화재 복구 확인 · 방재 시나리오 종료, 정상 운전 복귀")
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
        self.log("화재 감지 STA %s · 방재 시나리오 개시 (조명 최대, 화점 인접 제트팬 정지·상류측 정회전, 피난유도, 방송·VMS 연동)"
                 % self.sta(x), "alarm")

    def sta(self, p):
        a, b = self.c["sta"]
        v = round(a + (b - a) * p)
        return "%d+%03d" % (v // 1000, v % 1000)

    # ----- 운영자 명령 -----
    async def command(self, a, args, user):
        s, uname = self.state, user["name"]
        if not self.comm or not s:
            raise RuntimeError("RTU와 통신이 끊겨 명령을 보낼 수 없습니다")
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
