#!/usr/bin/env python3
"""합성 영수증·주문 화면 이미지 생성 (실제 개인정보 없음). 사용: python3 tools/make_receipts.py"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = os.path.join(os.path.dirname(__file__), "..", "app", "src", "androidTest", "assets", "receipts")
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
IDX = {"ko": 1, "ja": 0, "en": 0, "es": 0}  # ttc 안의 KR/JP 얼굴
R = {
 "ko": ["이음마켓 주문상세", "주문일자 2027.03.04", "주문번호 2027030412345678", "무선 이어폰 화이트", "상품금액 59,900원",
        "배송비 3,000원", "최종 결제금액 62,900원", "운송장번호 123456789012", "상품 수령 후 7일 이내 반품 가능"],
 "en": ["Sample Shop - Order details", "Order placed March 4, 2027", "Order # 112-3344556-7788990", "USB-C Charger 30W",
        "Item price $19.99", "Order total: $21.59", "Return by: 04/03/2027"],
 "ja": ["サンプルストア ご注文内容", "ご注文日 2027年3月4日", "注文番号 250304-0001234", "ワイヤレスマウス", "合計 5,900円", "返品期限 2027年3月18日"],
 "es": ["Tienda de Ejemplo - Pedido", "Fecha del pedido: 4 de marzo de 2027", "Nº de pedido: ES-778899", "Auriculares inalámbricos",
        "Total pagado 59,90 €", "Devolución hasta el 18/03/2027"],
 "multi": ["이음마켓 주문상세", "주문일자 2027.03.04", "주문번호 2027030499990000", "1. 텀블러 500ml  15,000원", "2. 텀블러 뚜껑  4,000원",
           "3. 세척솔  2,500원", "최종 결제금액 21,500원"],
 "mixed": ["해외직구 주문", "Order No. AB12345678", "Apple AirTag 4 Pack", "결제금액 US$99.00", "주문일 2027-03-04", "교환 기한 2027-03-25"],
 "ambiguous": ["Sample Store", "Order date 03/04/2027", "Order # XY-55555", "Desk lamp", "Total ¥3,200", "Delivered 3월 6일"],
}
def draw(lines, lang, w=1080):
    f = ImageFont.truetype(CJK, 44, index=IDX.get(lang, 1)); fb = ImageFont.truetype(CJK, 54, index=IDX.get(lang, 1))
    h = 160 + 90 * len(lines)
    im = Image.new("RGB", (w, h), "white"); d = ImageDraw.Draw(im)
    y = 60
    for i, t in enumerate(lines):
        d.text((60, y), t, fill=(20, 20, 20), font=fb if i == 0 else f); y += 90
        if i == 0: d.line((60, y - 14, w - 60, y - 14), fill=(120, 120, 120), width=3)
    return im
os.makedirs(OUT, exist_ok=True)
for k, lines in R.items():
    lang = "ko" if k in ("ko", "multi", "mixed", "ambiguous") else k
    im = draw(lines, lang); im.save(os.path.join(OUT, f"receipt_{k}.png"))
    if k == "ko": im.filter(ImageFilter.GaussianBlur(2.2)).save(os.path.join(OUT, "receipt_ko_blur.png"))
open(os.path.join(OUT, "not_an_image.png"), "wb").write(b"this is not a png file")
print(sorted(os.listdir(OUT)))
