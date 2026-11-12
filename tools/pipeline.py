#!/usr/bin/env python3
"""이음 키즈 컬러링 도안 전처리 파이프라인.

content/originals/aNN.png (Higgsfield 원본) ->
  app/src/main/assets/art/line/aNN.png   선화(검정 + 알파), 색칠 레이어 위에 덮는 용도
  app/src/main/assets/art/mask/aNN.png   영역 마스크(영역 번호 = R + G*256, 0 없음: 모든 픽셀이 어떤 영역에 속함)
  app/src/main/assets/art/thumb/aNN.webp 썸네일
  app/src/main/assets/art/catalog.json   메타데이터
  content/report.json                    검수 결과

원본이 없는 도안은 catalog 에 available=false 로 남기고 가짜 도안을 만들지 않는다.
사용법: python3 tools/pipeline.py  (저장소 루트에서)
"""
import json, os, sys, datetime
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(__file__))
from prompts import P, MODEL, MODEL_PARAMS, CATEGORIES, full_prompt

SIZE = 1536          # 앱용 작업 해상도
THUMB = 384
FIT = 0.90         # 도안을 캔버스의 90% 크기로 넣는다
MIN_REGION = 220     # 이보다 작은 영역(px)은 이웃 영역에 합친다 (터치하기 어려운 조각)
GAP_CLOSE = 5        # 미세한 틈 자동 보정: 선 끝 사이 이 정도(px) 틈은 메운다
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(ROOT, 'content', 'originals')
OUT = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'art')


def process(aid):
    path = os.path.join(ORIG, aid + ".png")
    if not os.path.exists(path):
        return None
    src = cv2.imread(path, cv2.IMREAD_COLOR)
    if src is None:
        return None
    rep = {}
    # 1) 품질 검수: 색/회색이 얼마나 섞였는지
    hsv = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)
    rep['colored_ratio'] = float(((hsv[..., 1] > 60) & (hsv[..., 2] > 60)).mean())
    gray = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
    rep['midgray_ratio'] = float(((gray > 90) & (gray < 200)).mean())
    # 2) 흑백 선화 정리
    rep['touches_border'] = bool((gray[:8] < 128).any() or (gray[-8:] < 128).any() or (gray[:, :8] < 128).any() or (gray[:, -8:] < 128).any())
    # 그림이 있는 부분만 잘라 정사각형으로 맞춘 뒤 캔버스의 FIT 크기로 넣는다 (도안마다 크기가 비슷해지고 흰 여백이 생긴다)
    ys, xs = np.nonzero(gray < 128)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(x1 - x0, y1 - y0)
    sq = np.full((side, side), 255, np.uint8)
    ox, oy = (side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2
    sq[oy:oy + y1 - y0, ox:ox + x1 - x0] = gray[y0:y1, x0:x1]
    inner = int(SIZE * FIT)
    rep['scale'] = round(float(inner) / float(side), 3)
    small = cv2.resize(sq, (inner, inner), interpolation=cv2.INTER_AREA if inner < side else cv2.INTER_CUBIC)
    gray = np.full((SIZE, SIZE), 255, np.uint8)
    o = (SIZE - inner) // 2
    gray[o:o + inner, o:o + inner] = small
    dark = 255 - gray.astype(np.int32)
    alpha = np.clip((dark - 40) * 255 // 150, 0, 255).astype(np.uint8)   # 연한 얼룩 제거 + 선은 진하게
    line = alpha > 110
    # 선에 붙지 않은 작은 점(잡티) 제거
    n, lab, st, _ = cv2.connectedComponentsWithStats(line.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 30:
            alpha[lab == i] = 0
            line[lab == i] = False
    rep['line_ratio'] = float(line.mean())
    # 3) 폐곡선 검사 + 미세한 틈 보정: 닫힘 연산으로 메워진 픽셀만 "보이지 않는 벽"으로 쓴다
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (GAP_CLOSE * 2 + 1, GAP_CLOSE * 2 + 1))
    closed = cv2.morphologyEx(line.astype(np.uint8), cv2.MORPH_CLOSE, k) > 0
    n0 = cv2.connectedComponents((~line).astype(np.uint8), connectivity=4)[0] - 1
    wall = closed
    # 4) 영역 라벨링 (Flood Fill 과 같은 4-연결 성분)
    n, lab, st, _ = cv2.connectedComponentsWithStats((~wall).astype(np.uint8), connectivity=4)
    big = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= MIN_REGION]
    rep['regions_before_gapfix'] = int(n0)
    rep['regions'] = len(big)
    rep['dropped_small'] = n - 1 - len(big)
    seeds = np.zeros((SIZE, SIZE), np.int32)
    for new, i in enumerate(big, start=1):
        seeds[lab == i] = new
    # 5) 선/작은 조각 픽셀은 가장 가까운 영역에 붙인다 -> 색이 선 밑까지 깔려 흰 틈이 안 생긴다
    _, idx = cv2.distanceTransformWithLabels((seeds == 0).astype(np.uint8), cv2.DIST_L2, 5,
                                             labelType=cv2.DIST_LABEL_PIXEL)
    zero_lab = idx[seeds > 0]
    lut = np.zeros(idx.max() + 1, np.int32)
    lut[zero_lab] = seeds[seeds > 0]
    full = lut[idx]
    assert full.min() >= 1
    areas = np.bincount(seeds.ravel(), minlength=len(big) + 1)[1:]
    rep['min_region_px'] = int(areas.min())
    rep['median_region_px'] = int(np.median(areas))
    # 저장
    for d in ('line', 'mask', 'thumb'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    rgba = np.zeros((SIZE, SIZE, 4), np.uint8)
    rgba[..., 3] = alpha
    cv2.imwrite(os.path.join(OUT, 'line', aid + '.png'), rgba, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    m = np.zeros((SIZE, SIZE, 3), np.uint8)
    m[..., 2] = full & 255          # R
    m[..., 1] = (full >> 8) & 255   # G
    cv2.imwrite(os.path.join(OUT, 'mask', aid + '.png'), m, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    th = cv2.resize(255 - alpha, (THUMB, THUMB), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, 'thumb', aid + '.webp'), th, [cv2.IMWRITE_WEBP_QUALITY, 80])
    # 영역별 정보(넓이, 대표점) - 앱에서 완성 판정/자동 색칠에 사용
    regs = []
    dist = cv2.distanceTransform((seeds > 0).astype(np.uint8), cv2.DIST_L2, 5)
    for r in range(1, len(big) + 1):
        ys, xs = np.nonzero(seeds == r)
        j = int(np.argmax(dist[ys, xs]))
        regs.append({'a': int(areas[r - 1]), 'x': int(xs[j]), 'y': int(ys[j])})
    # 바탕(배경) 영역: 테두리에 가장 많이 닿는 영역
    border = np.concatenate([full[0], full[-1], full[:, 0], full[:, -1]])
    rep['background_region'] = int(np.bincount(border).argmax())
    return rep, regs


def main():
    today = datetime.date.today().isoformat()
    sources = json.load(open(os.path.join(ROOT, 'content', 'sources.json')))
    # 이미 등록된 도안의 제작일은 그대로 둔다 (다시 돌려도 날짜가 바뀌지 않게)
    try:
        made = {r['id']: r.get('createdAt') for r in json.load(open(os.path.join(ROOT, 'content', 'prompts.json'))) if r.get('resultUrl')}
    except (OSError, ValueError):
        made = {}
    arts, report = [], {}
    for aid, title, cat, _diff, subject in P:
        res = process(aid)
        item = {'id': aid, 'title': title, 'category': cat, 'available': res is not None,
                'original': f'content/originals/{aid}.png', 'line': f'art/line/{aid}.png',
                'mask': f'art/mask/{aid}.png', 'thumb': f'art/thumb/{aid}.webp',
                'createdAt': made.get(aid) or today, 'model': MODEL, 'source': 'Higgsfield',
                'licenseReview': 'done'}
        if res:
            rep, regs = res
            n = rep['regions']
            item['difficulty'] = 1 if n <= 26 else (2 if n <= 40 else 3)
            item['regions'] = regs
            item['background'] = rep['background_region']
            report[aid] = rep
        else:
            item['difficulty'] = _diff
            report[aid] = {'missing': True}
        arts.append(item)
    json.dump({'version': 1, 'size': SIZE, 'categories': CATEGORIES, 'artworks': arts},
              open(os.path.join(OUT, 'catalog.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(report, open(os.path.join(ROOT, 'content', 'report.json'), 'w'), ensure_ascii=False, indent=1)
    # 프롬프트/제작 기록
    rec = [{'id': a, 'title': t, 'prompt': full_prompt(a, s), 'model': MODEL, 'params': MODEL_PARAMS,
            'createdAt': made.get(a) or today, 'resultUrl': sources.get(a)} for a, t, _c, _d, s in P]
    json.dump(rec, open(os.path.join(ROOT, 'content', 'prompts.json'), 'w'), ensure_ascii=False, indent=1)
    ok = sum(1 for a in arts if a['available'])
    print(f'{ok}/{len(arts)} 등록')
    for a, r in report.items():
        print(a, r)


if __name__ == '__main__':
    main()
