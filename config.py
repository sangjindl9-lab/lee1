"""설정값. .env 파일에서 읽어옵니다."""
import os
from dotenv import load_dotenv

load_dotenv()

# 서버(Render 등)에서는 TZ=Asia/Seoul 환경변수로 한국 시간을 맞춥니다.
# 저장 폴더: 상태·로그·모델·데이터가 저장되는 곳
STORAGE_DIR = os.getenv("STORAGE_DIR", ".")
os.makedirs(STORAGE_DIR, exist_ok=True)


def _p(name):
    return os.path.join(STORAGE_DIR, name)


def _f(key, default):
    return float(os.getenv(key, default))


def _i(key, default):
    return int(os.getenv(key, default))


# ── KIS 계정 ─────────────────────────────────────────
APP_KEY = os.getenv("KIS_APP_KEY", "")
APP_SECRET = os.getenv("KIS_APP_SECRET", "")
ACCOUNT_NO = os.getenv("KIS_ACCOUNT_NO", "")        # 계좌번호 앞 8자리
ACCOUNT_PROD = os.getenv("KIS_ACCOUNT_PROD", "01")  # 계좌상품코드 뒤 2자리
KIS_ENV = os.getenv("KIS_ENV", "real")              # real | virtual

# 실제 주문 안전장치: YES 로 바꿔야만 진짜 주문이 나갑니다.
LIVE_TRADING = os.getenv("LIVE_TRADING", "NO").upper() == "YES"

# ── 매매 대상 ────────────────────────────────────────
# 기본값: 대형 우량주 일부 (삼성전자, SK하이닉스, LG에너지솔루션, 삼성바이오, 현대차,
#          기아, 셀트리온, KB금융, NAVER, 신한지주, POSCO홀딩스, 카카오)
UNIVERSE = os.getenv(
    "UNIVERSE",
    "005930,000660,373220,207940,005380,000270,068270,105560,035420,055550,005490,035720",
).split(",")

NAMES = {
    "005930": "삼성전자", "000660": "SK하이닉스", "373220": "LG에너지솔루션",
    "207940": "삼성바이오로직스", "005380": "현대차", "000270": "기아",
    "068270": "셀트리온", "105560": "KB금융", "035420": "NAVER",
    "055550": "신한지주", "005490": "POSCO홀딩스", "035720": "카카오",
}

# ── 웹 대시보드 ──────────────────────────────────────
WEB_PASSWORD = os.getenv("WEB_PASSWORD", "")   # 비우면 이 컴퓨터에서만 접속 가능
WEB_PORT = _i("PORT", _i("WEB_PORT", 8000))

# ── 모델 ────────────────────────────────────────────
HORIZON = _i("HORIZON", 5)            # 며칠 뒤 수익률을 예측할지 (=보유기간)
TARGET_RET = _f("TARGET_RET", 0.01)   # 이 수익률 이상이면 '상승'으로 라벨링
BUY_THRESHOLD = _f("BUY_THRESHOLD", 0.60)   # 상승확률이 이 이상이면 매수 후보
SELL_THRESHOLD = _f("SELL_THRESHOLD", 0.40) # 보유 중 확률이 이 아래로 떨어지면 매도
MODEL_PATH = _p("model.joblib")

# ── 리스크 관리 ──────────────────────────────────────
MAX_POSITIONS = _i("MAX_POSITIONS", 3)          # 동시 보유 종목 수
MAX_ORDER_KRW = _i("MAX_ORDER_KRW", 300_000)    # 종목당 최대 매수금액(원)
STOP_LOSS = _f("STOP_LOSS", -0.05)              # 손절 -5%
TAKE_PROFIT = _f("TAKE_PROFIT", 0.08)           # 익절 +8%
DAILY_LOSS_LIMIT_KRW = _i("DAILY_LOSS_LIMIT_KRW", 100_000)  # 하루 실현손실 한도
KILL_SWITCH_FILE = _p("STOP")   # 이 이름의 파일이 있으면 즉시 매매 중단

# ── 비용 (백테스트용) ────────────────────────────────
FEE = _f("FEE", 0.00015)       # 매매수수료 (편도)
SELL_TAX = _f("SELL_TAX", 0.002)  # 매도 시 거래세 — 현재 세율을 확인해 맞추세요

STATE_FILE = _p("state.json")
LOG_FILE = _p("trader.log")
BACKTEST_FILE = _p("backtest.json")
DATA_DIR = _p("data")
TOKEN_CACHE = _p(".kis_token.json")

# 증권사 키가 없으면 데모 모드 (가짜 계좌·가짜 시세, 주문 절대 안 나감)
DEMO = not (APP_KEY and APP_SECRET and ACCOUNT_NO)
if DEMO:
    LIVE_TRADING = False
