"""가상 RTU-E1 (PLC) 시뮬레이터.

실제 현장의 RTU-E1 / 전자배전반 / 조명제어기 / 제트팬 MCC 대신 Modbus TCP 서버로 동작한다.
터널마다 Unit ID(1,2,3…) 하나씩. 주소는 app/tagmap.py 기본 맵을 따른다.

PLC 쪽에서 하는 일(실제 현장과 같은 역할 분담):
  - 차단기 투입/개방 펄스 처리, 정전 시 부하 차단
  - 제트팬 정↔역 전환 인터락 (정지 후 잔류회전 대기)
  - 조명 단계 출력, 유도등 점멸/피난유도
  - 계측값(전압·전류·전력·CO·VI·풍속·휘도) 생성
단독 실행:  python -m sim.plc_sim
"""
import asyncio
import json
import math
import os
import random
import sys
import time

from pymodbus.datastore import ModbusSequentialDataBlock, ModbusServerContext, ModbusSlaveContext
from pymodbus.server import StartAsyncTcpServer

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
from app.tagmap import FC, STAGES, default_tags, fan_ids  # noqa: E402

REVERSE_WAIT_S = 6.0      # 정↔역 전환 시 잔류회전 대기 (실시간 초)
INRUSH_S = 2.5            # 기동 돌입전류 지속


class Fan:
    def __init__(self, fid, hrs):
        self.id, self.st, self.fault, self.lock, self.start, self.hrs, self.amp = fid, 0, False, 0.0, 0.0, hrs, 0.0


class Plc:
    def __init__(self, cfg, slave, speed):
        self.cfg, self.sl = cfg, slave
        self.tags = {t["tag"]: t for t in default_tags(cfg)}
        self.feeders = cfg["feeders"]
        self.br = {f: True for f in ["HV-1"] + self.feeders}
        self.fans = [Fan(f, 820 + i * 41 + random.randint(0, 300)) for i, f in enumerate(fan_ids(cfg["fans"]))]
        self.minute, self.day = 13 * 60.0, 0
        self.cloud, self.co, self.vi, self.wind, self.boost = .9, 14.0, .0021, 1.3, 0.0
        self.stage, self.batt, self.ups_on, self.pump = 0, 100.0, True, False
        self.kwh = 182340 + random.random() * 900
        self.set("SIM.KEPCO", 1)
        self.set("SIM.SPEED", speed)
        self.set("LT.ST1_CMD", 1)
        for f in self.fans:
            self.set(f.id + ".REM", 1)

    # ----- 레지스터 입출력 -----
    def get(self, tag):
        t = self.tags[tag]
        fc = FC[t["type"]]
        if t["dtype"] == "uint32":
            hi, lo = self.sl.getValues(fc, t["addr"], 2)
            return ((hi << 16) | lo) * t["scale"]
        v = self.sl.getValues(fc, t["addr"], 1)[0]
        if t["dtype"] == "bool":
            return bool(v)
        if v > 32767:
            v -= 65536
        return v * t["scale"]

    def set(self, tag, val):
        t = self.tags[tag]
        fc = FC[t["type"]]
        if t["dtype"] == "bool":
            self.sl.setValues(fc, t["addr"], [1 if val else 0])
            return
        raw = int(round(val / t["scale"]))
        if t["dtype"] == "uint32":
            raw = max(0, min(raw, 0xFFFFFFFF))
            self.sl.setValues(fc, t["addr"], [(raw >> 16) & 0xFFFF, raw & 0xFFFF])
        else:
            raw = max(-32768, min(raw, 32767))
            self.sl.setValues(fc, t["addr"], [raw & 0xFFFF])

    def pulse(self, tag):
        if self.get(tag):
            self.set(tag, 0)
            return True
        return False

    # ----- 1 스캔 -----
    def scan(self, dt):
        now = time.monotonic()
        speed = max(1, self.get("SIM.SPEED"))
        sd = dt * speed                                  # 모의 경과 초
        self.minute += sd / 60
        if self.minute >= 1440:
            self.minute -= 1440
            self.day += 1
        h = self.minute / 60

        # 차단기 펄스
        for b in ["HV-1"] + self.feeders:
            if self.pulse(b + ".CLOSE"):
                self.br[b] = True
            if self.pulse(b + ".OPEN"):
                self.br[b] = False
        # 모의 입력
        kepco = self.get("SIM.KEPCO") != 0
        ff = int(self.get("SIM.FAULT"))
        if ff:
            if 1 <= ff <= len(self.fans):
                self.fans[ff - 1].fault = True
            self.set("SIM.FAULT", 0)
        b = self.get("SIM.CO_BOOST")
        if b > 0:
            self.boost = b
            self.set("SIM.CO_BOOST", 0)
        if self.pulse("FD.RESET"):
            self.set("SIM.FIRE", 0)
        fire = self.get("SIM.FIRE")
        fire = fire / 1000 if fire > 0 else None

        # 외부 휘도
        sun = max(0.0, math.sin(math.pi * (h - 6.2) / 12.8))
        self.cloud = min(1, max(.3, self.cloud + (random.random() - .5) * .02 * min(5, sd / 60)))
        lum = max(0.0, 5200 * sun * self.cloud + ((random.random() - .5) * 60 if sun > 0 else 0))
        grid = kepco and self.br["HV-1"]

        # 조명 (단계 명령 코일 중 첫 번째)
        for i in range(len(STAGES)):
            if self.get("LT.ST%d_CMD" % (i + 1)):
                self.stage = i
                break
        st = STAGES[self.stage]
        ent = st["ent"] if grid and self.br["LV-102"] else 0
        base = st["base"] if grid and self.br["LV-101"] else 0

        tr = 0.0 if fire else .15 + .85 * max(math.exp(-((h - 8.4) ** 2) / 1.6), math.exp(-((h - 18.4) ** 2) / 2.4), .45 * sun)

        # 제트팬
        fp = grid and self.br["LV-103"]
        run = 0
        for f in self.fans:
            if self.pulse(f.id + ".RESET"):
                f.fault = False
            fw, rv = self.get(f.id + ".FWD_CMD"), self.get(f.id + ".REV_CMD")
            cmd = 1 if fw and not rv else -1 if rv and not fw else 0
            if f.fault or not fp:
                f.st, f.lock = 0, 0.0
            elif cmd != f.st:
                if cmd == 0:
                    f.st, f.lock = 0, 0.0
                elif f.st != 0:                      # 정↔역 직접 전환 금지 → 정지 후 대기
                    f.st, f.lock = 0, now + REVERSE_WAIT_S
                elif now >= f.lock:
                    f.st, f.start, f.lock = cmd, now, 0.0
            if f.st:
                run += 1
                f.hrs += sd / 3600
                f.amp = 158 + random.random() * 8 if now - f.start < INRUSH_S else 52 + random.random() * 3
            else:
                f.amp = 0.0

        # 환경
        self.boost = max(0.0, self.boost - sd / 60 * 2.5)
        k = min(1.0, sd / 300)
        tgt = max(3.0, 6 + tr * 44 - run * 7 + self.boost + (130 if fire else 0))
        self.co = max(1.0, self.co + (tgt - self.co) * k + (random.random() - .5) * .6)
        vt = max(.0008, .0014 + tr * .0042 - run * .0005 + self.boost * .00004 + (.011 if fire else 0))
        self.vi = max(.0005, self.vi + (vt - self.vi) * k + (random.random() - .5) * .00004)
        self.wind = max(0.0, self.wind + ((run * .85 + tr * 1.4) - self.wind) * k + (random.random() - .5) * .08)
        if random.random() < sd / 1200:
            self.pump = not self.pump

        # 전력
        nz = lambda: 1 + (random.random() - .5) * .02  # noqa: E731
        fk, tot = {}, 0.0
        for fd in self.feeders:
            v = 0.0
            if grid and self.br[fd]:
                v = {
                    "LV-101": 52 * base / 100, "LV-102": 150 * ent / 100,
                    "LV-103": sum((82 if f.amp > 100 else 30) for f in self.fans if f.st),
                    "LV-104": 7.5 if self.pump else .2, "LV-105": 5.8, "LV-106": 3.6,
                    "LV-107": 8.4 + tr * 3, "LV-108": 11.0, "LV-109": 1.2,
                    "LV-UPS": self.cfg["ups_kva"] * .8 * .55 + (.8 if self.batt < 100 else 0),
                }.get(fd, 2.0) * nz()
            fk[fd] = v
            tot += v
        self.kwh += tot * sd / 3600
        if not grid:
            if self.ups_on:
                self.batt = max(0.0, self.batt - sd / (30 * 60) * 100 * .62)
                if self.batt <= 0:
                    self.ups_on = False
        else:
            self.ups_on = True
            if self.br.get("LV-UPS", True):
                self.batt = min(100.0, self.batt + sd / (120 * 60) * 100)

        # ----- 출력 쓰기 -----
        S = self.set
        S("HV-1.VCB", self.br["HV-1"]); S("HV-1.UVR", not kepco); S("HV-1.OCR", 0); S("HV-1.OCGR", 0)
        for p in ["RS", "ST", "TR"]:
            S("HV-1.V_" + p, (22.9 + (random.random() - .5) * .06) if kepco else 0)
        ia = tot * 1000 / (1.732 * 22900 * .92) if grid else 0
        for p in "RST":
            S("HV-1.A_" + p, ia * (1 + (random.random() - .5) * .03))
        S("HV-1.KW", tot); S("HV-1.PF", .92 if grid else 0); S("HV-1.HZ", 60 if kepco else 0)
        S("HV-1.KWH", self.kwh)
        S("PTR-1.TEMP", 38 + tot / 300 * 35); S("LTR-1.TEMP", 34 + fk.get("LV-101", 0) / 52 * 20)
        for fd in self.feeders:
            pf = .85 if fd == "LV-103" else .95 if fd in ("LV-101", "LV-102") else .9
            S(fd + ".ST", self.br[fd]); S(fd + ".TRIP", 0)
            S(fd + ".KW", fk[fd]); S(fd + ".A", fk[fd] * 1000 / (1.732 * 380 * pf))
        S("UPS.RUN", self.ups_on); S("UPS.BATT_DIS", self.ups_on and not grid); S("UPS.BATT", self.batt)
        for i in range(len(STAGES)):
            S("LT.ST%d_FB" % (i + 1), i == self.stage)
        S("LT.L20", lum)
        S("ENV.CO1", self.co); S("ENV.CO2", self.co * .94)
        S("ENV.VI1", self.vi); S("ENV.VI2", self.vi * .96)
        S("ENV.WS", self.wind); S("ENV.WD", 1 if self.wind > .3 else 0); S("ENV.TRAFFIC", tr * 1800)
        for f in self.fans:
            S(f.id + ".FWD", f.st == 1); S(f.id + ".REV", f.st == -1); S(f.id + ".FLT", f.fault)
            S(f.id + ".WAIT", f.lock > now); S(f.id + ".A", f.amp); S(f.id + ".HRS", f.hrs)
        zone = min(3, int(fire * 4)) if fire else -1
        for z in range(4):
            S("FD.Z%d" % (z + 1), z == zone)
        S("FD.POS", round(fire * 1000) if fire else 0)
        S("EV.PWR", grid or self.ups_on)
        S("SIM.MINUTE", int(self.minute)); S("SIM.DAY", self.day)


def build(cfg_path=None):
    cfg_path = cfg_path or os.path.join(BASE, "config.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    speed = cfg.get("simulator", {}).get("speed", 60)
    slaves, plcs = {}, []
    for t in cfg["tunnels"]:
        sl = ModbusSlaveContext(
            di=ModbusSequentialDataBlock(0, [0] * 300), co=ModbusSequentialDataBlock(0, [0] * 300),
            hr=ModbusSequentialDataBlock(0, [0] * 300), ir=ModbusSequentialDataBlock(0, [0] * 300),
            zero_mode=True)
        slaves[t["unit"]] = sl
        plcs.append(Plc(t, sl, speed))
    return cfg, ModbusServerContext(slaves=slaves, single=False), plcs


async def run(cfg_path=None, host="0.0.0.0"):
    cfg, ctx, plcs = build(cfg_path)
    port = cfg.get("simulator", {}).get("port", 5020)

    async def scanner():
        last = time.monotonic()
        while True:
            await asyncio.sleep(0.2)
            now = time.monotonic()
            dt, last = now - last, now
            for p in plcs:
                try:
                    p.scan(dt)
                except Exception as e:  # 시뮬레이터가 멈추지 않도록
                    print("[SIM] scan error", p.cfg["key"], e)

    for p in plcs:
        p.scan(0.01)
    asyncio.create_task(scanner())
    print("[SIM] 가상 RTU-E1 Modbus TCP %s:%d  Unit %s" % (host, port, ",".join(str(t["unit"]) for t in cfg["tunnels"])))
    await StartAsyncTcpServer(context=ctx, address=(host, port))


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else None))
