"""데모 모드: 증권사 키 없이 화면을 확인하기 위한 가짜 계좌·가짜 시세.
진짜 주문은 절대 나가지 않습니다."""
import zlib
from datetime import datetime

import numpy as np
import pandas as pd

import config


class DemoKIS:
    _holdings = {}
    _cash = 3_000_000.0

    def daily_ohlcv(self, code, days=750):
        rng = np.random.default_rng(zlib.crc32(code.encode()))
        n = 750
        idx = pd.bdate_range(end=datetime.now().date(), periods=n)
        close = 50_000 * np.exp(np.cumsum(rng.normal(0.0003, 0.02, n)))
        close = np.round(close, -1)
        df = pd.DataFrame({
            "open": close * (1 + rng.normal(0, 0.004, n)),
            "high": close * (1 + abs(rng.normal(0, 0.01, n))),
            "low": close * (1 - abs(rng.normal(0, 0.01, n))),
            "close": close,
            "volume": rng.integers(100_000, 2_000_000, n).astype(float),
        }, index=idx)
        df.index.name = "date"
        return df.tail(days)

    def current_price(self, code):
        return float(self.daily_ohlcv(code, 1)["close"].iloc[-1])

    def balance(self):
        for code, h in self._holdings.items():
            h["price"] = self.current_price(code)
        return {c: dict(h) for c, h in self._holdings.items()}, self._cash

    def order(self, code, qty, side):
        price = self.current_price(code)
        if side == "buy":
            DemoKIS._cash -= qty * price
            DemoKIS._holdings[code] = {"name": config.NAMES.get(code, code), "qty": qty,
                                       "avg_price": price, "price": price}
        else:
            DemoKIS._cash += qty * price
            DemoKIS._holdings.pop(code, None)
        return {"output": {"ODNO": "DEMO"}}
