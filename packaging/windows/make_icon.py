"""설치판 아이콘(webnvr.ico) 생성 — 카메라 렌즈 모양의 단순한 도형."""
import sys

from PIL import Image, ImageDraw


def draw(n: int) -> Image.Image:
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = n / 64
    d.rounded_rectangle((4 * s, 14 * s, 50 * s, 50 * s), radius=7 * s, fill=(23, 28, 33, 255),
                        outline=(245, 183, 0, 255), width=max(1, int(3 * s)))
    d.polygon([(50 * s, 26 * s), (61 * s, 19 * s), (61 * s, 45 * s), (50 * s, 38 * s)], fill=(245, 183, 0, 255))
    d.ellipse((17 * s, 22 * s, 37 * s, 42 * s), outline=(230, 233, 236, 255), width=max(1, int(3 * s)))
    d.ellipse((24 * s, 29 * s, 30 * s, 35 * s), fill=(229, 72, 77, 255))
    return im


if __name__ == "__main__":
    big = draw(256)
    big.save(sys.argv[1], sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
