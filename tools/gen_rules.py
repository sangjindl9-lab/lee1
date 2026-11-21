#!/usr/bin/env python3
"""쇼핑몰 화면 가져오기 규칙 생성 → 앱 내장(assets)과 안내 서버(site/public/rules) 두 곳에 같은 파일. 사용: python3 tools/gen_rules.py
규칙을 고치면 version 을 올릴 것(앱은 더 높은 버전만 받아 씀)."""
import json, os
VERSION = 2
KO_NOISE = r"(모두\s*보기|자주\s*산|로켓프레시|로켓배송|판매자로켓|^\+\d+$|문앞|주문\s*상세|주문\s*목록|배송\s*조회|배송\s*완료|배송\s*중|배송\s*준비|상품\s*준비|도착|출고|교환|반품|취소|환불|리뷰|후기|장바구니|재구매|다시\s*구매|구매\s*확정|문의|판매자|로켓|더\s*보기|검색|마이쿠팡|함께\s*구매|추천|광고|쿠폰|적립|혜택|결제\s*완료|결제\s*수단|배송지|받는\s*분|^\d+\s*개$|스토어\s*찜|톡톡|알림받기|네이버페이|N\s*Pay|포인트|^전체$|^\d{1,2}월$)"
EN_NOISE = r"(?i)^(order placed|ordered on|total|ship to|order\s*#|view order details|view invoice|invoice|order details|delivered|arriving|now arriving|your package|package was|buy it again|view your item|track package|return or replace|return items|replace item|share gift receipt|write a product review|leave seller feedback|get product support|archive order|problem with order|ask product question|shipped|not yet shipped|cancel items|return window closed|returned|refund|.*eligible through|your orders|orders|buy again|not yet shipped|cancelled orders|digital orders|local store orders|search all orders|past \d+ (days|months)|\d{4}$|hello, .*|sign in|account|lists|cart|deliver to.*|returns\s*&\s*orders)"
RULES = {"version": VERSION, "malls": [
  {"id": "coupang", "name": {"ko": "쿠팡", "en": "Coupang", "ja": "Coupang", "es": "Coupang"}, "currency": "KRW",
   "ordersUrl": "https://mc.coupang.com/ssr/desktop/order/list",
   # 목록: 날짜만 있는 줄 '2026. 11. 20' (예전 형식 '… 주문' 포함), 상세: '주문일 2026. 11. 20'
   "anchor": r"^(?:주문\s*일(?:자|시)?\s*[:：]?\s*)?\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?(?:\s*주문)?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?$",
   "orderNo": r"주문\s*번호\s*[:：]?\s*(\d{6,})",
   "total": r"(?:총\s*결제\s*금액|결제\s*금액|총\s*주문\s*금액)\s*[:：]?\s*([\d,]+)\s*원",
   "price": r"([\d,]{2,})\s*원",
   "returnBy": None, "noise": KO_NOISE, "skipAfter": r"^(받는\s*(분|사람)|수령인)$", "needPrice": True,
   "useImageAlt": True, "expand": r"^\d+\s*개\s*상품\s*모두\s*보기"},
  {"id": "naver", "name": {"ko": "네이버 쇼핑(네이버페이)", "en": "Naver Shopping", "ja": "NAVERショッピング", "es": "Naver Shopping"}, "currency": "KRW",
   "ordersUrl": "https://order.pay.naver.com/home",
   "anchor": r"^(\d{4}\.\s*)?\d{1,2}\.\s*\d{1,2}\.?\s*(결제|주문)",
   "orderNo": r"주문\s*번호\s*[:：]?\s*(\d{10,})",
   "total": r"(?:총\s*결제\s*금액|결제\s*금액)\s*[:：]?\s*([\d,]+)\s*원",
   "price": r"([\d,]{2,})\s*원",
   "returnBy": None, "noise": KO_NOISE, "skipAfter": r"^(받는\s*(분|사람)|수령인)$", "needPrice": True},
  {"id": "amazon_us", "name": {"ko": "아마존 (미국)", "en": "Amazon.com", "ja": "Amazon.com(米国)", "es": "Amazon.com (EE. UU.)"}, "currency": "USD",
   "ordersUrl": "https://www.amazon.com/gp/css/order-history",
   "anchor": r"(?i)^(order placed|ordered on)\b",
   "orderNo": r"(?i)order\s*#\s*((?:\d{3}|D\d{2})-\d{7}-\d{7})",
   "total": r"(?i)^total\s*\n?\s*\$\s?([\d,]+\.\d{2})",
   "price": r"\$\s?([\d,]+\.\d{2})",
   "returnBy": r"(?i)(?:return|replace)[^\n]*eligible through\s+([A-Za-z]+\.? \d{1,2},? \d{4})",
   "noise": EN_NOISE, "skipAfter": r"(?i)^ship to$", "needPrice": False},
]}
s = json.dumps(RULES, ensure_ascii=False, indent=1)
root = os.path.join(os.path.dirname(__file__), "..")
for p in ["app/src/main/assets/import_rules.json", "site/public/rules/v1.json"]:
    open(os.path.join(root, p), "w", encoding="utf-8").write(s + "\n")
# 정규식이 파이썬에서도 컴파일되는지 간단 확인
import re
for m in RULES["malls"]:
    for k in ("anchor", "orderNo", "total", "price", "returnBy", "noise", "skipAfter"):
        if m.get(k): re.compile(m[k].replace("(?i)", ""), re.I | re.M)
print("ok v%d, %d malls" % (VERSION, len(RULES["malls"])))
