"""시세 데이터 다운로드 / 캐시 (data/ 폴더에 종목별 CSV)."""
import os

import pandas as pd

import config

DATA_DIR = config.DATA_DIR


def download_all(days=750):
    from kis_api import get_kis
    kis = get_kis()
    os.makedirs(DATA_DIR, exist_ok=True)
    for code in config.UNIVERSE:
        df = kis.daily_ohlcv(code, days)
        df.to_csv(f"{DATA_DIR}/{code}.csv")
        print(f"{code}: {len(df)}일 ({df.index[0].date()} ~ {df.index[-1].date()})")


def load_all():
    out = {}
    for code in config.UNIVERSE:
        path = f"{DATA_DIR}/{code}.csv"
        if os.path.exists(path):
            out[code] = pd.read_csv(path, index_col="date", parse_dates=True)
    if not out:
        raise FileNotFoundError("data/ 폴더가 비어 있습니다. 먼저 `python main.py download` 를 실행하세요.")
    return out
