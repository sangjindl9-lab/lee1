# API 설정 매뉴얼

모든 외부 API 키는 로그인 후 **API 연결 관리** 화면에서 등록합니다. 서버에서 Fernet으로 암호화해 저장하고 화면·로그에는 앞뒤 3자만 보입니다.
관리자는 "서비스 공용 키"로 등록해 모든 사용자가 쓰게 할 수 있고, 사용자가 자기 키를 넣으면 그 키가 우선합니다.

| 공급자 | 용도 | 필요한 값 | 발급 위치 | 연결 테스트가 하는 일 |
|---|---|---|---|---|
| Higgsfield | 이미지, 이미지→영상 | API Key ID, Secret | open.higgsfield.ai → API Keys | 존재하지 않는 요청 상태 조회(무료). 401=키 오류, 404=인증 통과 |
| Claude / OpenAI / Gemini | 기획·대본·스토리보드·검수 | API 키 | 각 콘솔 | 모델 목록 조회(무료) |
| ElevenLabs | 음성(글자 단위 타임스탬프) | API 키 | elevenlabs.io | 음성 목록 조회(무료) |
| OpenAI | 음성(tts), 음성 인식(whisper), 이미지 | API 키 | platform.openai.com | 모델 목록 조회 |
| Tavily / Brave | 웹 조사 | API 키 | 각 콘솔 | 검색 1회 실행(크레딧 1회 사용) |
| YouTube Data API v3 | 인기 영상 조사 | API 키 | Google Cloud 콘솔 | videos.list 1회(쿼터 1) |
| Google OAuth | 채널 연결·업로드·성과 | 클라이언트 ID, 시크릿 (관리자) | Google Cloud 콘솔 → OAuth 클라이언트(웹) | 저장만. 실제 확인은 채널 연결 시 |

## Higgsfield (2026-11-27 공식 문서 확인 내용)

- Base URL `https://api.higgsfield.ai`, 헤더 `Authorization: Key {ID}:{SECRET}`
- 제출 `POST /{모델 경로}` + `Idempotency-Key` → `request_id`, `status_url`
- 상태 `queued → in_progress → completed | failed | nsfw | canceled`, 결과 `images[].url` / `video.url`
- 결과 파일은 7일 뒤 삭제되므로 완료 즉시 내려받아 자체 저장소에 보관합니다.
- 오류: 401 인증, **403 잔액 부족**, 404 계정에서 모델 없음, 422 검증 실패, 429 큐 가득참(Retry-After), 503 모델 미준비
- `failed`·`nsfw` 는 과금되지 않습니다(예약 금액 환불). 대기열 취소도 환불.
- **웹사이트 구독 크레딧과 API 잔액은 별개입니다.** API는 선불 잔액(USD)에서 차감됩니다.
- 잔액 조회 엔드포인트는 공식 문서에 없어 화면에 잔액을 표시하지 못합니다. 잔액 부족은 403 응답으로 감지합니다.

### 기본 등록 모델

| 모델 키 | 경로 | 스키마 | 단가 |
|---|---|---|---|
| hf-z-image-turbo | `z-image/turbo` | 확인 | **미등록** — 콘솔에서 확인 후 입력 |
| hf-soul-v2 | `higgsfield-ai/soul/v2/standard` | 확인 | **미등록** |
| hf-wan3-prime-i2v / t2v | `alibaba/wan-3.0-prime/image-to-video` 등 | 확인 | $0.068/초 (정가) |
| hf-kling3-std-i2v | `kling-video/v3.0/std/image-to-video` | 확인 | $0.063/초 |
| hf-kling3-pro-i2v | `kling-video/v3.0/pro/image-to-video` | 미검증, 꺼짐 | $0.084/초 |

정가 기준이며 계정 할인·해상도에 따라 실제 단가가 다릅니다. **첫 제작 뒤 콘솔의 실제 청구액과 비교해 단가를 맞추세요.**

### 새 Higgsfield 모델 추가

1. 화면에서 모델 추가(공급자·종류·경로).
2. 공식 문서의 입력 스키마에 맞춰 capabilities 를 지정합니다(관리자 토큰 필요).

```bash
curl -X PATCH $API/api/models/<모델 키> -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "unit": "per_second", "unit_cost_usd": 0.145,
  "default_params": {"resolution": "720p", "generate_audio": false},
  "capabilities": {"duration": [4, 30], "aspect_ratios": ["9:16", "16:9"],
                   "param_map": {"image": "image_url", "end_image": "end_image_url", "seed": "seed"}},
  "schema_verified": true }'
```
`param_map` 의 키: `prompt`, `aspect`, `duration`, `image`, `end_image`, `seed`, `reference`, `negative` → 값은 그 모델의 실제 필드명.
`aspect_ratios` 를 생략하면 화면비 필드를 보내지 않습니다(Kling처럼 입력 이미지를 따르는 모델).

## 언어 AI 모델 ID

기본 등록값은 `claude-sonnet-5-5`, `claude-haiku-5-5` 입니다. 연결 테스트가 돌려주는 **실제 모델 목록**을 보고 모델 표의 "공급자 모델 경로·ID"를 맞추세요.
OpenAI·Gemini 모델은 기본 등록이 없으니 "모델 추가"로 넣습니다. 품질검수는 이미지 입력을 쓰므로 비전 지원 모델이어야 합니다.
단가는 입력/출력 100만 토큰당 USD로 넣습니다.

## YouTube

- **조사용 API 키**: search.list 가 호출당 100단위라, 프로젝트당 기본 900단위(관리자 설정)에서 기간·검색어 조합을 자동으로 줄입니다. 일일 기본 쿼터는 10,000단위입니다.
- **OAuth**: 승인된 리디렉션 URI에 `{PUBLIC_BASE_URL}/api/youtube/oauth/callback` 을 등록합니다(채널 연결 화면에 표시됨). 범위: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`.
- OAuth 동의 화면이 "테스트" 상태면 테스트 사용자만 연결할 수 있고, API 감사를 통과하지 않은 프로젝트로 올린 영상은 공개를 선택해도 비공개로 제한됩니다. 실제 계정으로 확인하세요.
- 타 채널의 유지율·이탈률·CTR은 공개 API에 없어 표시하지 않습니다. 실제 조회수 증가량은 같은 영상의 스냅샷이 2개 이상일 때만 계산합니다.
