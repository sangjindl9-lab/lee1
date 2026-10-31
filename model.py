"""머신러닝 모델 학습 / 예측 (Gradient Boosting)."""
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

import config
from features import FEATURES, make_dataset, make_features


def build_panel(prices):
    """종목별 데이터를 하나로 합친 학습용 테이블."""
    frames = []
    for code, df in prices.items():
        d = make_dataset(df, config.HORIZON, config.TARGET_RET)
        d["code"] = code
        frames.append(d)
    panel = pd.concat(frames).dropna(subset=FEATURES)
    return panel.sort_index()


def new_model():
    return HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.03, max_depth=4,
        min_samples_leaf=50, l2_regularization=1.0, random_state=42,
    )


def train_test(prices, train_ratio=0.7):
    """앞쪽 70% 기간으로 학습, 뒤쪽 30%로 검증. (시간순 분리, 미래 데이터 누설 방지)"""
    panel = build_panel(prices).dropna(subset=["label"])
    dates = panel.index.unique().sort_values()
    cut = dates[int(len(dates) * train_ratio)]
    gap = dates[min(int(len(dates) * train_ratio) + config.HORIZON, len(dates) - 1)]
    train = panel[panel.index < cut]
    test = panel[panel.index > gap]

    m = new_model().fit(train[FEATURES], train["label"])
    test = test.copy()
    test["prob"] = m.predict_proba(test[FEATURES])[:, 1]

    auc = roc_auc_score(test["label"], test["prob"])
    test.attrs["auc"] = round(float(auc), 3)
    picked = test[test["prob"] >= config.BUY_THRESHOLD]
    print(f"학습 {train.index.min().date()}~{train.index.max().date()} ({len(train)}건) | "
          f"검증 {test.index.min().date()}~{test.index.max().date()} ({len(test)}건)")
    print(f"검증 AUC: {auc:.3f}  (0.5 = 동전던지기)")
    print(f"기본 상승비율: {test['label'].mean():.1%} | "
          f"확률≥{config.BUY_THRESHOLD:.2f} 신호 {len(picked)}건 적중률: "
          f"{picked['label'].mean() if len(picked) else float('nan'):.1%}, "
          f"평균 {config.HORIZON}일 수익률: {picked['fwd_ret'].mean() if len(picked) else float('nan'):+.2%}")
    return m, test


def train_full(prices):
    """실전용: 전체 기간으로 학습 후 저장."""
    panel = build_panel(prices).dropna(subset=["label"])
    m = new_model().fit(panel[FEATURES], panel["label"])
    joblib.dump({"model": m, "features": FEATURES, "horizon": config.HORIZON,
                 "trained_until": str(panel.index.max().date())}, config.MODEL_PATH)
    print(f"모델 저장: {config.MODEL_PATH} (데이터 {len(panel)}건, ~{panel.index.max().date()})")
    return m


def load_model():
    return joblib.load(config.MODEL_PATH)["model"]


def predict_latest(model, df):
    """가장 최근 거래일 기준 상승확률."""
    feat = make_features(df)[FEATURES].dropna()
    if feat.empty:
        return np.nan
    return float(model.predict_proba(feat.iloc[[-1]])[:, 1][0])
