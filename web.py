"""웹 대시보드 + 자동매매 동시 실행.

  python web.py   →  브라우저에서 http://localhost:8000
"""
import hmac
import json
import os
import secrets
import threading
import time
from collections import deque
from datetime import datetime

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

import config

app = Flask(__name__)
app.secret_key = os.getenv("WEB_SECRET") or secrets.token_hex(32)

app.context_processor(lambda: {"config": config})

lock = threading.Lock()        # 매매 판단·주문이 겹치지 않게
_trader, _trader_err = None, None
_loop_started = False
_cache = {"t": 0, "data": None, "err": None}
_train = {"running": False, "msg": None}


# ── 매매 엔진 ──────────────────────────────────────
def get_trader():
    global _trader, _trader_err
    if _trader is None:
        if not os.path.exists(config.MODEL_PATH):
            _trader_err = "모델이 아직 없습니다. 학습이 끝나면 자동으로 시작됩니다." if _train["running"] \
                else "모델이 없습니다. [AI 재학습] 버튼을 눌러주세요."
            return None
        try:
            from trader import Trader
            _trader = Trader()
            _trader_err = None
        except Exception as e:      # 키 미입력, 모델 없음 등
            _trader_err = str(e)
    return _trader


def start_loop():
    global _loop_started
    t = get_trader()
    if t is None or _loop_started:
        return
    from trader import run_loop
    threading.Thread(target=run_loop, args=(t, lock), daemon=True).start()
    _loop_started = True


def train_job():
    """시세 다운로드 → 검증·백테스트 → 모델 저장 → 매매 엔진에 반영."""
    import logging
    log = logging.getLogger("trader")
    _train.update(running=True, msg="시세 다운로드 중…")
    try:
        from data import download_all, load_all
        from model import train_test, train_full, load_model
        from backtest import run_backtest
        log.info("AI 재학습 시작")
        download_all()
        _train["msg"] = "모델 학습 중…"
        prices = load_all()
        _, test = train_test(prices)
        run_backtest(test, prices)
        train_full(prices)
        with lock:
            if _trader is not None:
                _trader.model = load_model()
        start_loop()
        log.info(f"AI 재학습 완료 (AUC {test.attrs.get('auc')})")
        _train["msg"] = None
    except Exception as e:
        log.exception(f"재학습 실패: {e}")
        _train["msg"] = f"재학습 실패: {e}"
    finally:
        _train["running"] = False


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def tail_log(n=80):
    try:
        with open(config.LOG_FILE, encoding="utf-8") as f:
            return list(deque(f, maxlen=n))[::-1]
    except OSError:
        return []


def account():
    """잔고는 20초 캐시 (KIS 호출 제한 대비)."""
    t = get_trader()
    if t is None:
        return None, _trader_err
    if time.time() - _cache["t"] > 20:
        try:
            _cache["data"], _cache["err"] = t.kis.balance(), None
        except Exception as e:
            _cache["err"] = str(e)
        _cache["t"] = time.time()
    return _cache["data"], _cache["err"]


# ── 로그인 ────────────────────────────────────────
@app.before_request
def guard():
    if not config.WEB_PASSWORD or request.endpoint in ("login", "static"):
        return
    if not session.get("ok"):
        if request.path.startswith("/api/"):
            return jsonify(error="login"), 401
        return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    err = None
    if request.method == "POST":
        if hmac.compare_digest(request.form.get("pw", ""), config.WEB_PASSWORD):
            session["ok"] = True
            session.permanent = True
            return redirect(url_for("index"))
        err = "비밀번호가 틀렸습니다."
        time.sleep(1)
    return render_template("login.html", err=err)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ── 화면 / API ────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def status():
    state = read_json(config.STATE_FILE, {"positions": {}, "realized": {}})
    acct, acct_err = account()
    holdings, cash = (acct if acct else ({}, None))

    bot_codes = set(state.get("positions", {}))
    rows = []
    for code, h in holdings.items():
        rows.append({
            "code": code, "name": h["name"], "qty": h["qty"],
            "avg": h["avg_price"], "price": h["price"],
            "value": h["qty"] * h["price"],
            "pnl": (h["price"] - h["avg_price"]) * h["qty"],
            "ret": h["price"] / h["avg_price"] - 1 if h["avg_price"] else 0,
            "bot": code in bot_codes,
            "entry": state["positions"].get(code, {}).get("entry_date"),
        })
    rows.sort(key=lambda r: (not r["bot"], -r["value"]))

    probs = [{"code": c, "name": config.NAMES.get(c, c), "prob": p, "held": c in bot_codes}
             for c, p in state.get("last_probs", {}).items()]
    probs.sort(key=lambda x: -x["prob"])

    model_info = None
    if os.path.exists(config.MODEL_PATH):
        import joblib
        m = joblib.load(config.MODEL_PATH)
        model_info = {"trained_until": m.get("trained_until"), "horizon": m.get("horizon")}

    today = datetime.now().strftime("%Y-%m-%d")
    realized = state.get("realized", {})
    return jsonify(
        now=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        env=config.KIS_ENV, live=config.LIVE_TRADING, demo=config.DEMO,
        training=_train["running"], train_msg=_train["msg"],
        stopped=os.path.exists(config.KILL_SWITCH_FILE),
        loop=_loop_started, engine_error=_trader_err, account_error=acct_err,
        cash=cash, holdings=rows,
        today_realized=realized.get(today, 0),
        realized_history=sorted(realized.items())[-30:],
        probs=probs, last_decide=state.get("last_decide"),
        model=model_info,
        settings={
            "buy": config.BUY_THRESHOLD, "sell": config.SELL_THRESHOLD,
            "max_pos": config.MAX_POSITIONS, "max_order": config.MAX_ORDER_KRW,
            "stop_loss": config.STOP_LOSS, "take_profit": config.TAKE_PROFIT,
            "daily_limit": config.DAILY_LOSS_LIMIT_KRW, "horizon": config.HORIZON,
        },
        log=tail_log(),
    )


@app.route("/api/backtest")
def backtest():
    return jsonify(read_json(config.BACKTEST_FILE))


@app.route("/api/stop", methods=["POST"])
def toggle_stop():
    if os.path.exists(config.KILL_SWITCH_FILE):
        os.remove(config.KILL_SWITCH_FILE)
        msg = "긴급정지 해제 (웹)"
    else:
        open(config.KILL_SWITCH_FILE, "w").close()
        msg = "긴급정지 설정 (웹)"
    import logging
    logging.getLogger("trader").warning(msg)
    return jsonify(ok=True, stopped=os.path.exists(config.KILL_SWITCH_FILE))


@app.route("/api/retrain", methods=["POST"])
def retrain():
    if _train["running"]:
        return jsonify(ok=False, error="이미 학습 중입니다."), 409
    threading.Thread(target=train_job, daemon=True).start()
    return jsonify(ok=True)


@app.route("/api/decide", methods=["POST"])
def decide_now():
    t = get_trader()
    if t is None:
        return jsonify(ok=False, error=_trader_err), 400
    if not lock.acquire(blocking=False):
        return jsonify(ok=False, error="이미 실행 중입니다."), 409

    def job():
        try:
            t.decide()
        except Exception as e:
            import logging
            logging.getLogger("trader").exception(f"웹 실행 오류: {e}")
        finally:
            _cache["t"] = 0
            lock.release()
    threading.Thread(target=job, daemon=True).start()
    return jsonify(ok=True)


def main():
    if not os.path.exists(config.MODEL_PATH):   # 서버 첫 실행 시 자동 학습
        _train["running"] = True
        threading.Thread(target=train_job, daemon=True).start()
    start_loop()
    host = "0.0.0.0" if config.WEB_PASSWORD else "127.0.0.1"
    print(f"\n대시보드: http://localhost:{config.WEB_PORT}"
          + ("" if config.WEB_PASSWORD else "  (WEB_PASSWORD 미설정 → 이 컴퓨터에서만 접속)"))
    try:
        from waitress import serve
        serve(app, host=host, port=config.WEB_PORT, threads=4)
    except ImportError:
        app.run(host=host, port=config.WEB_PORT, threaded=True)


if __name__ == "__main__":
    main()
