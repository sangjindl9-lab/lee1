"""검증 구간(학습에 안 쓴 기간) 모의 매매로 전략 성과 확인."""
import pandas as pd

import config


def run_backtest(test, prices, capital=10_000_000):
    """test: model.train_test() 가 돌려준 검증 데이터 (prob 포함)."""
    probs = test.pivot_table(index=test.index, columns="code", values="prob")
    closes = pd.DataFrame({c: df["close"] for c, df in prices.items()}).reindex(probs.index)

    cash, pos, trades, equity = capital, {}, [], []
    for date in probs.index:
        px, pr = closes.loc[date], probs.loc[date]

        # 1) 매도 판단
        for code in list(pos):
            p = pos[code]
            ret = px[code] / p["entry"] - 1
            p["days"] += 1
            reason = None
            if ret <= config.STOP_LOSS: reason = "손절"
            elif ret >= config.TAKE_PROFIT: reason = "익절"
            elif p["days"] >= config.HORIZON: reason = "기간만료"
            elif pr.get(code, 1) < config.SELL_THRESHOLD: reason = "확률하락"
            if reason:
                proceeds = p["qty"] * px[code] * (1 - config.FEE - config.SELL_TAX)
                cash += proceeds
                trades.append({"date": date, "code": code, "ret": proceeds / p["cost"] - 1, "reason": reason})
                del pos[code]

        # 2) 매수: 확률 높은 순
        cands = pr[(pr >= config.BUY_THRESHOLD) & (~pr.index.isin(list(pos)))].sort_values(ascending=False)
        for code in cands.index:
            if len(pos) >= config.MAX_POSITIONS:
                break
            budget = cash / (config.MAX_POSITIONS - len(pos))
            qty = int(budget // (px[code] * (1 + config.FEE)))
            if qty <= 0:
                continue
            cost = qty * px[code] * (1 + config.FEE)
            cash -= cost
            pos[code] = {"qty": qty, "entry": px[code], "cost": cost, "days": 0}

        equity.append(cash + sum(p["qty"] * px[c] for c, p in pos.items()))

    eq = pd.Series(equity, index=probs.index)
    tr = pd.DataFrame(trades)
    bench = closes.pct_change().mean(axis=1).fillna(0).add(1).cumprod() * capital  # 동일비중 보유

    total = eq.iloc[-1] / capital - 1
    mdd = (eq / eq.cummax() - 1).min()
    print(f"\n── 백테스트 ({eq.index[0].date()} ~ {eq.index[-1].date()}) ──")
    print(f"전략 수익률: {total:+.2%} | 최대낙폭(MDD): {mdd:.2%}")
    print(f"비교(유니버스 동일비중 보유): {bench.iloc[-1] / capital - 1:+.2%}")
    if len(tr):
        print(f"거래 {len(tr)}회 | 승률 {(tr['ret'] > 0).mean():.1%} | 평균 {tr['ret'].mean():+.2%}")
        print("청산 사유:", tr["reason"].value_counts().to_dict())
    else:
        print("거래 없음 — BUY_THRESHOLD 를 낮춰보세요.")

    # 웹 대시보드용 결과 저장
    import json
    result = {
        "auc": test.attrs.get("auc"),
        "period": f"{eq.index[0].date()} ~ {eq.index[-1].date()}",
        "dates": [d.strftime("%Y-%m-%d") for d in eq.index],
        "equity": [round(x / capital * 100, 2) for x in eq],
        "bench": [round(x / capital * 100, 2) for x in bench],
        "total": round(total * 100, 2), "mdd": round(mdd * 100, 2),
        "bench_total": round((bench.iloc[-1] / capital - 1) * 100, 2),
        "trades": int(len(tr)),
        "win_rate": round((tr["ret"] > 0).mean() * 100, 1) if len(tr) else None,
        "avg_ret": round(tr["ret"].mean() * 100, 2) if len(tr) else None,
        "reasons": tr["reason"].value_counts().to_dict() if len(tr) else {},
    }
    with open(config.BACKTEST_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return eq, tr
