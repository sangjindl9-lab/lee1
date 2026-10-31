"""실시간 자동매매 실행부."""
import json
import logging
import os
import time
from datetime import datetime, time as dtime

import config
from kis_api import KISError, get_kis
from model import load_model, predict_latest

log = logging.getLogger("trader")
if not log.handlers:   # 매매 로그만 trader.log 에 기록 (웹 접속 로그 제외)
    log.setLevel(logging.INFO)
    log.propagate = False
    _fmt = logging.Formatter("%(asctime)s %(message)s", "%Y-%m-%d %H:%M:%S")
    for _h in (logging.FileHandler(config.LOG_FILE, encoding="utf-8"), logging.StreamHandler()):
        _h.setFormatter(_fmt)
        log.addHandler(_h)

DECISION_TIME = dtime(15, 10)   # 장 마감 20분 전에 예측·매매
MONITOR_EVERY_MIN = 10           # 장중 손절/익절 체크 주기


# ── 상태 저장 (봇이 산 종목만 관리 — 직접 산 주식은 건드리지 않음) ──
def load_state():
    if os.path.exists(config.STATE_FILE):
        with open(config.STATE_FILE) as f:
            return json.load(f)
    return {"positions": {}, "realized": {}}


def save_state(s):
    with open(config.STATE_FILE, "w") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)


def market_open(now=None):
    now = now or datetime.now()
    return now.weekday() < 5 and dtime(9, 0) <= now.time() <= dtime(15, 20)


def kill_switch():
    if os.path.exists(config.KILL_SWITCH_FILE):
        log.warning("STOP 파일 감지 → 매매 중단")
        return True
    return False


class Trader:
    def __init__(self):
        self.kis = get_kis()
        self.model = load_model()
        self.state = load_state()
        mode = "데모(가짜 데이터)" if config.DEMO else "실전 주문" if config.LIVE_TRADING else "모의 실행(주문 안 나감)"
        log.info(f"시작 — 서버: {config.KIS_ENV}, 모드: {mode}")

    def today_loss(self):
        return -min(0, self.state["realized"].get(datetime.now().strftime("%Y-%m-%d"), 0))

    def _order(self, code, qty, side, why):
        tag = "매수" if side == "buy" else "매도"
        name = config.NAMES.get(code, code)
        if config.DEMO:   # 가짜 계좌에만 반영
            self.kis.order(code, qty, side)
            log.info(f"[데모 {tag}] {name}({code}) {qty}주 — {why}")
            return True
        if not config.LIVE_TRADING:
            log.info(f"[모의 {tag}] {code} {qty}주 — {why}")
            return True
        try:
            r = self.kis.order(code, qty, side)
            log.info(f"[{tag} 체결요청] {code} {qty}주 주문번호 {r['output'].get('ODNO')} — {why}")
            return True
        except KISError as e:
            log.error(f"[{tag} 실패] {code}: {e}")
            return False

    def _sell(self, code, h, why):
        if self._order(code, h["qty"], "sell", why):
            pnl = (h["price"] - h["avg_price"]) * h["qty"]
            d = datetime.now().strftime("%Y-%m-%d")
            self.state["realized"][d] = self.state["realized"].get(d, 0) + pnl
            self.state["positions"].pop(code, None)
            save_state(self.state)

    def _bot_holdings(self):
        holdings, cash = self.kis.balance()
        mine = {c: h for c, h in holdings.items() if c in self.state["positions"]}
        # 수동으로 팔았거나 체결 안 된 종목은 상태에서 정리
        for c in list(self.state["positions"]):
            if c not in holdings and self.state["positions"][c].get("entry_date") != datetime.now().strftime("%Y-%m-%d"):
                self.state["positions"].pop(c)
        save_state(self.state)
        return mine, cash

    # ── 장중 손절/익절 감시 ─────────────────────────
    def monitor(self):
        if kill_switch():
            return
        mine, _ = self._bot_holdings()
        for code, h in mine.items():
            ret = h["price"] / h["avg_price"] - 1
            if ret <= config.STOP_LOSS:
                self._sell(code, h, f"손절 {ret:+.2%}")
            elif ret >= config.TAKE_PROFIT:
                self._sell(code, h, f"익절 {ret:+.2%}")

    # ── 하루 1회 AI 판단 ────────────────────────────
    def decide(self):
        if kill_switch():
            return
        mine, cash = self._bot_holdings()

        probs, frames = {}, {}
        for code in config.UNIVERSE:
            try:
                df = self.kis.daily_ohlcv(code, 120)
                frames[code] = df
                probs[code] = predict_latest(self.model, df)
            except KISError as e:
                log.error(f"{code} 시세 실패: {e}")
        log.info("상승확률: " + ", ".join(f"{c} {p:.2f}" for c, p in sorted(probs.items(), key=lambda x: -x[1])))
        self.state["last_probs"] = {c: round(p, 4) for c, p in probs.items() if p == p}
        self.state["last_decide"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        save_state(self.state)

        # 매도
        for code, h in mine.items():
            ret = h["price"] / h["avg_price"] - 1
            entry = self.state["positions"][code]["entry_date"]
            held = (frames[code].index > entry).sum() if code in frames else 0
            p = probs.get(code, 1)
            if ret <= config.STOP_LOSS: why = f"손절 {ret:+.2%}"
            elif ret >= config.TAKE_PROFIT: why = f"익절 {ret:+.2%}"
            elif held >= config.HORIZON: why = f"보유 {held}일 만료 ({ret:+.2%})"
            elif p < config.SELL_THRESHOLD: why = f"확률 {p:.2f} 하락 ({ret:+.2%})"
            else: continue
            self._sell(code, h, why)

        # 매수
        if self.today_loss() >= config.DAILY_LOSS_LIMIT_KRW:
            log.warning(f"오늘 손실 {self.today_loss():,.0f}원 — 한도 도달, 신규 매수 중단")
            return
        held_codes = set(self.state["positions"])
        cands = sorted(((p, c) for c, p in probs.items() if p >= config.BUY_THRESHOLD and c not in held_codes), reverse=True)
        for p, code in cands:
            if len(self.state["positions"]) >= config.MAX_POSITIONS:
                break
            price = self.kis.current_price(code)
            budget = min(config.MAX_ORDER_KRW, cash * 0.98)
            qty = int(budget // price)
            if qty <= 0:
                log.info(f"{code}: 예수금 부족으로 매수 생략")
                continue
            if self._order(code, qty, "buy", f"상승확률 {p:.2f}, {price:,.0f}원"):
                cash -= qty * price
                self.state["positions"][code] = {"entry_date": datetime.now().strftime("%Y-%m-%d"), "prob": p}
                save_state(self.state)


def run_loop(t=None, lock=None):
    import contextlib
    t = t or Trader()
    lock = lock or contextlib.nullcontext()
    last_decide, last_monitor = None, 0
    while True:
        now = datetime.now()
        try:
            if market_open(now):
                if now.time() >= DECISION_TIME and last_decide != now.date():
                    with lock:
                        t.decide()
                    last_decide = now.date()
                elif time.time() - last_monitor >= MONITOR_EVERY_MIN * 60:
                    with lock:
                        t.monitor()
                    last_monitor = time.time()
        except Exception as e:   # 네트워크 오류 등으로 프로그램이 죽지 않게
            log.exception(f"오류: {e}")
        time.sleep(30)
