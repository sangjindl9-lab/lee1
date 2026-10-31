"""
사용법
  python main.py download   # KIS에서 3년치 일봉 다운로드
  python main.py train      # 모델 검증 + 백테스트 + 실전용 모델 저장
  python main.py web        # ★ 웹 대시보드 + 자동매매 시작 → http://localhost:8000
  python main.py run        # 자동매매만 시작 (화면 없이)
  python main.py decide     # 지금 즉시 AI 판단 1회 실행 (테스트용)
  python main.py balance    # 잔고 확인
"""
import sys


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "download":
        from data import download_all
        download_all()
    elif cmd == "train":
        from data import load_all
        from model import train_test, train_full
        from backtest import run_backtest
        prices = load_all()
        _, test = train_test(prices)
        run_backtest(test, prices)
        train_full(prices)
    elif cmd == "web":
        from web import main as web_main
        web_main()
    elif cmd == "run":
        from trader import run_loop
        run_loop()
    elif cmd == "decide":
        from trader import Trader
        Trader().decide()
    elif cmd == "balance":
        from kis_api import get_kis
        holdings, cash = get_kis().balance()
        print(f"주문가능 예수금: {cash:,.0f}원")
        for c, h in holdings.items():
            print(f"{c} {h['name']} {h['qty']}주  평단 {h['avg_price']:,.0f}  현재 {h['price']:,.0f}  "
                  f"({h['price'] / h['avg_price'] - 1:+.2%})")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
