"""공통 유틸: 한국시간, 금액/수량 Decimal 처리."""
from datetime import date, datetime
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation

from .config import KST

QTY_Q = Decimal("0.001")      # 수량: 소수 3자리
PRICE_Q = Decimal("0.01")     # 단가: 소수 2자리
WON = Decimal("1")            # 금액: 원 단위
RATE_Q = Decimal("0.01")      # 공정률(%): 소수 2자리


def now_kst() -> datetime:
    return datetime.now(KST)


def today_kst() -> date:
    return now_kst().date()


def D(v, default: Decimal | None = Decimal("0")) -> Decimal:
    """입력값을 Decimal 로 변환. float 은 문자열을 거쳐 이진 오차를 막는다."""
    if v is None or v == "":
        if default is None:
            raise ValueError("숫자 값이 필요합니다")
        return default
    if isinstance(v, Decimal):
        return v
    if isinstance(v, float):
        v = repr(v)
    try:
        return Decimal(str(v).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        raise ValueError(f"숫자 형식이 올바르지 않습니다: {v}")


def round_amount(v: Decimal, rule: str = "floor") -> Decimal:
    """금액 반올림 규칙. floor=원 미만 절사(기본), half_up=원 미만 반올림."""
    mode = ROUND_DOWN if rule == "floor" else ROUND_HALF_UP
    return D(v).quantize(WON, rounding=mode)


def q_qty(v) -> Decimal:
    return D(v).quantize(QTY_Q, rounding=ROUND_HALF_UP)


def q_price(v) -> Decimal:
    return D(v).quantize(PRICE_Q, rounding=ROUND_HALF_UP)


def q_rate(v: Decimal) -> Decimal:
    return v.quantize(RATE_Q, rounding=ROUND_HALF_UP)


def s(v) -> str | None:
    """Decimal → 문자열 (지수표기 없이, 불필요한 0 제거)."""
    if v is None:
        return None
    d = D(v)
    t = format(d, "f")
    if "." in t:
        t = t.rstrip("0").rstrip(".")
    return t or "0"


def vat_of(supply: Decimal, rule: str = "floor") -> Decimal:
    return round_amount(supply * Decimal("0.1"), rule)
