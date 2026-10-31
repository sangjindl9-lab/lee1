"""일봉 데이터 → 머신러닝 입력 특징(feature) 생성."""
import numpy as np
import pandas as pd

FEATURES = [
    "ret_1", "ret_5", "ret_20", "ma5_ratio", "ma20_ratio", "ma60_ratio",
    "rsi14", "vol20", "vol_ratio", "bb_pos", "macd_hist", "hl_range", "gap",
]


def _rsi(close, n=14):
    diff = close.diff()
    up = diff.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-diff.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / down.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def make_features(df):
    """df: index=date, columns=open/high/low/close/volume"""
    c, v = df["close"], df["volume"]
    out = pd.DataFrame(index=df.index)
    out["ret_1"] = c.pct_change(1)
    out["ret_5"] = c.pct_change(5)
    out["ret_20"] = c.pct_change(20)
    for n in (5, 20, 60):
        out[f"ma{n}_ratio"] = c / c.rolling(n).mean() - 1
    out["rsi14"] = _rsi(c) / 100
    out["vol20"] = c.pct_change().rolling(20).std()
    out["vol_ratio"] = v / v.rolling(20).mean().replace(0, np.nan)
    ma20, sd20 = c.rolling(20).mean(), c.rolling(20).std()
    out["bb_pos"] = (c - ma20) / (2 * sd20.replace(0, np.nan))
    ema12, ema26 = c.ewm(span=12).mean(), c.ewm(span=26).mean()
    macd = ema12 - ema26
    out["macd_hist"] = (macd - macd.ewm(span=9).mean()) / c
    out["hl_range"] = (df["high"] - df["low"]) / c
    out["gap"] = df["open"] / c.shift(1) - 1
    return out.replace([np.inf, -np.inf], np.nan)


def make_dataset(df, horizon, target_ret):
    """특징 + 정답(라벨). 라벨 = horizon일 뒤 수익률이 target_ret 이상이면 1."""
    feat = make_features(df)
    fwd = df["close"].shift(-horizon) / df["close"] - 1
    feat["fwd_ret"] = fwd
    feat["label"] = (fwd > target_ret).astype(int)
    feat.loc[fwd.isna(), "label"] = np.nan   # 미래 데이터가 없는 최근 구간은 학습 제외
    return feat
