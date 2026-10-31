# 슬롯 플랫폼

서버가 모든 결과와 잔액을 처리하는 멀티 게임 슬롯 플랫폼입니다. 플레이어 로비, 게임 클라이언트, 운영 관리 페이지가 들어 있습니다.

## 실행

```bash
npm install
ADMIN_PASSWORD='관리자비밀번호' npm start      # http://localhost:3000
```

| 주소 | 용도 |
|---|---|
| `/` | 플레이어 로그인 |
| `/lobby` | 게임 목록 · 내 기록 |
| `/play?g=<게임id>` | 게임 |
| `/admin` | 운영 관리 (대시보드 · 플레이어 · 회차 기록 · 게임 설정 · 감사 로그) |

환경 변수: `PORT`, `ADMIN_USER`(기본 admin), `ADMIN_PASSWORD`(처음 실행할 때만 사용, 없으면 무작위 생성 후 로그에 출력), `DB_PATH`(기본 `data/slot.db`), `NODE_ENV=production`(쿠키 Secure).
Node 22.13 이상이 필요합니다 (내장 SQLite 사용).

## 구조

```
server/
  index.js                 API (플레이어·스핀·관리자)
  db.js, auth.js           SQLite 스키마, 세션·비밀번호(scrypt)
  engine/core.js           범용 라인 슬롯 엔진 (릴 수·행 수·라인·와일드·스캐터)
  engine/features/         보너스 기능 플러그인 (현재: expandingFreeSpins)
  games/<id>/math.js       게임별 수학 모델 (심볼·배당·릴 구성·기능)
  games/index.js           게임 등록 목록
  sim.js                   RTP 시뮬레이터
public/
  shared/                  공용 게임 셸 (릴 애니메이션·연출·합성 사운드·파티클)
  shared/features/<type>.js  보너스 기능 화면 연출
  games/<id>/theme.js      게임별 그래픽·색·사운드 음계·문구
  admin/                   운영 관리 페이지
```

## 새 슬롯 추가하는 법

1. `server/games/<id>/math.js` 작성 — 릴·행 수, 라인, 심볼 배당, 릴 구성, 기능.
2. `npm run sim -- <id> 10000000` 으로 RTP 확인 후 `rtp` 값 기입.
3. `public/games/<id>/theme.js` 작성 — `symbol(id)` 렌더링, 색 변수, 배경, 사운드 음계.
4. `server/games/index.js`의 `IDS`에 추가 후 재시작. 관리자 → 게임 설정에서 공개/베팅 한도 조정.

새 보너스 방식(캐스케이드, 홀드앤윈, 배수 등)은 `server/engine/features/`에 서버 판정을, `public/shared/features/`에 같은 이름으로 연출을 추가합니다.

## 현재 게임

| 게임 | 구성 | 이론 RTP | 비고 |
|---|---|---|---|
| 용의 비서 (`jade-scroll`) | 5×3 · 10라인 | 약 96.7% | 와일드·스캐터, 확장 심볼 무료 회전, 평균 약 166스핀마다 보너스 |
| 황금 등롱 (`golden-lantern`) | 3×3 · 5라인 | 96.47% (전 조합 계산) | 와일드, 저변동성 |

## 운영 전 확인할 것

- 실제 금전 운영에는 관할 라이선스(필리핀: PAGCOR)와 게임별 RNG·수학 모델 공인 시험기관 인증이 필요합니다.
- 금액은 정수(센트)로 저장되며 모든 베팅·당첨·조정이 `tx` 원장에 남습니다. 플레이어 잔액은 원장 합계와 항상 일치해야 합니다.
- 결제·입출금 연동, 본인 확인, 책임 있는 게임(입금 한도·자가 제한)은 아직 들어 있지 않습니다.
- 그래픽은 SVG, 사운드는 실시간 합성입니다. 정식 출시 전 전문 아트·사운드 에셋으로 교체를 권장합니다.
