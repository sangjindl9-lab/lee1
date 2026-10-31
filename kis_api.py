"""한국투자증권 Open API (KIS Developers) 래퍼 — 국내주식."""
import json
import os
import time
from datetime import datetime, timedelta

import pandas as pd
import requests

import config

BASE_URL = {
    "real": "https://openapi.koreainvestment.com:9443",
    "virtual": "https://openapivts.koreainvestment.com:29443",
}[config.KIS_ENV]
IS_REAL = config.KIS_ENV == "real"
TOKEN_CACHE = config.TOKEN_CACHE


class KISError(Exception):
    pass


def get_kis():
    """키가 있으면 진짜 KIS, 없으면 데모."""
    if config.DEMO:
        from demo import DemoKIS
        return DemoKIS()
    return KIS()


class KIS:
    def __init__(self):
        if not (config.APP_KEY and config.APP_SECRET and config.ACCOUNT_NO):
            raise KISError(".env 에 KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT_NO 를 입력하세요.")
        self.token = self._get_token()

    # ── 인증 ────────────────────────────────────────
    def _get_token(self):
        # 토큰은 하루 유효하고 1분에 1회만 발급되므로 파일에 캐시합니다.
        if os.path.exists(TOKEN_CACHE):
            with open(TOKEN_CACHE) as f:
                c = json.load(f)
            if c.get("env") == config.KIS_ENV and datetime.fromisoformat(c["expires"]) > datetime.now() + timedelta(minutes=10):
                return c["token"]
        r = requests.post(
            f"{BASE_URL}/oauth2/tokenP",
            json={"grant_type": "client_credentials", "appkey": config.APP_KEY, "appsecret": config.APP_SECRET},
            timeout=10,
        )
        data = r.json()
        if "access_token" not in data:
            raise KISError(f"토큰 발급 실패: {data}")
        expires = datetime.now() + timedelta(seconds=int(data.get("expires_in", 86400)))
        with open(TOKEN_CACHE, "w") as f:
            json.dump({"token": data["access_token"], "expires": expires.isoformat(), "env": config.KIS_ENV}, f)
        return data["access_token"]

    def _headers(self, tr_id):
        return {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.token}",
            "appkey": config.APP_KEY,
            "appsecret": config.APP_SECRET,
            "tr_id": tr_id,
            "custtype": "P",
        }

    def _get(self, path, tr_id, params):
        for attempt in range(3):
            r = requests.get(f"{BASE_URL}{path}", headers=self._headers(tr_id), params=params, timeout=10)
            data = r.json()
            if data.get("rt_cd") == "0":
                return data
            if "초당" in data.get("msg1", ""):   # 호출 제한 → 잠깐 쉬고 재시도
                time.sleep(1)
                continue
            raise KISError(f"{tr_id} 실패: {data.get('msg1')}")
        raise KISError(f"{tr_id} 재시도 초과")

    def _post(self, path, tr_id, body):
        r = requests.post(f"{BASE_URL}{path}", headers=self._headers(tr_id), json=body, timeout=10)
        data = r.json()
        if data.get("rt_cd") != "0":
            raise KISError(f"{tr_id} 실패: {data.get('msg1')}")
        return data

    # ── 시세 ────────────────────────────────────────
    def daily_ohlcv(self, code, days=750):
        """일봉 (수정주가). 한 번에 100개씩 과거로 거슬러 가며 받습니다."""
        rows, end = [], datetime.now()
        while len(rows) < days:
            start = end - timedelta(days=140)
            data = self._get(
                "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
                "FHKST03010100",
                {
                    "FID_COND_MRKT_DIV_CODE": "J",
                    "FID_INPUT_ISCD": code,
                    "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
                    "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
                    "FID_PERIOD_DIV_CODE": "D",
                    "FID_ORG_ADJ_PRC": "0",
                },
            )
            chunk = [x for x in data.get("output2", []) if x.get("stck_bsop_date")]
            if not chunk:
                break
            rows.extend(chunk)
            end = datetime.strptime(chunk[-1]["stck_bsop_date"], "%Y%m%d") - timedelta(days=1)
            time.sleep(0.1 if IS_REAL else 0.6)
        df = pd.DataFrame(rows).drop_duplicates("stck_bsop_date")
        df = pd.DataFrame({
            "date": pd.to_datetime(df["stck_bsop_date"]),
            "open": df["stck_oprc"].astype(float),
            "high": df["stck_hgpr"].astype(float),
            "low": df["stck_lwpr"].astype(float),
            "close": df["stck_clpr"].astype(float),
            "volume": df["acml_vol"].astype(float),
        })
        return df.sort_values("date").set_index("date").tail(days)

    def current_price(self, code):
        data = self._get(
            "/uapi/domestic-stock/v1/quotations/inquire-price",
            "FHKST01010100",
            {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
        )
        return float(data["output"]["stck_prpr"])

    # ── 계좌 ────────────────────────────────────────
    def balance(self):
        """(보유종목 dict, 주문가능현금) 반환."""
        data = self._get(
            "/uapi/domestic-stock/v1/trading/inquire-balance",
            "TTTC8434R" if IS_REAL else "VTTC8434R",
            {
                "CANO": config.ACCOUNT_NO, "ACNT_PRDT_CD": config.ACCOUNT_PROD,
                "AFHR_FLPR_YN": "N", "OFL_YN": "", "INQR_DVSN": "02", "UNPR_DVSN": "01",
                "FUND_STTL_ICLD_YN": "N", "FNCG_AMT_AUTO_RDPT_YN": "N", "PRCS_DVSN": "00",
                "CTX_AREA_FK100": "", "CTX_AREA_NK100": "",
            },
        )
        holdings = {}
        for h in data.get("output1", []):
            qty = int(h["hldg_qty"])
            if qty > 0:
                holdings[h["pdno"]] = {
                    "name": h["prdt_name"], "qty": qty,
                    "avg_price": float(h["pchs_avg_pric"]), "price": float(h["prpr"]),
                }
        summary = data["output2"][0]
        cash = float(summary.get("prvs_rcdl_excc_amt") or summary["dnca_tot_amt"])  # D+2 예수금
        return holdings, cash

    # ── 주문 ────────────────────────────────────────
    def order(self, code, qty, side):
        """시장가 주문. side = 'buy' | 'sell'."""
        if side == "buy":
            tr_id = "TTTC0012U" if IS_REAL else "VTTC0012U"
        else:
            tr_id = "TTTC0011U" if IS_REAL else "VTTC0011U"
        return self._post(
            "/uapi/domestic-stock/v1/trading/order-cash",
            tr_id,
            {
                "CANO": config.ACCOUNT_NO, "ACNT_PRDT_CD": config.ACCOUNT_PROD,
                "PDNO": code, "ORD_DVSN": "01",  # 01 = 시장가
                "ORD_QTY": str(int(qty)), "ORD_UNPR": "0",
            },
        )
