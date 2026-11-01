# 이음사인 연동 API (ERP·그룹웨어용)

아래 예제의 키·주소·이름은 모두 **가짜 값**입니다.

## 1. 인증·권한
- 설정 › API·Webhook 에서 키를 발급합니다. 키는 한 번만 보입니다.
- 요청 헤더: `Authorization: Bearer isk_예시키`
- 키는 **만든 직원의 권한 안에서만** 동작합니다. 그 직원이 퇴사하면 키도 폐기됩니다.
- 권한 범위: `templates:read`, `documents:read`, `documents:write`, `documents:send`, `documents:cancel`, `files:read`
- 요청 횟수 제한: 키별 분당 N회(기본 60). 넘으면 `429` + `Retry-After`.
- 재발급: 기존 키는 즉시 폐기되고 같은 범위의 새 키가 나옵니다.

## 2. 요청 중복 방지 (POST 필수)
- 모든 POST 에 `Idempotency-Key: <업무 시스템의 고유 요청번호>` 를 넣습니다.
- 같은 키로 다시 보내면 처음 응답을 그대로 돌려줍니다 (`Idempotency-Replay: true`). 문서가 두 번 생기지 않습니다.
- 같은 키로 **다른 본문**을 보내면 `409`.
- 문서 생성 + `send:true` 에서 생성은 됐지만 발송이 거절된 경우(예: 결재 필요)도 그 응답이 저장됩니다. 문서 번호로 상태를 조회해 이어서 처리하세요.

## 3. 엔드포인트
| 메서드 | 경로 | 범위 | 설명 |
|---|---|---|---|
| GET | /api/v1/templates | templates:read | 쓸 수 있는 템플릿·입력 항목·역할 |
| POST | /api/v1/documents | documents:write (+send) | 템플릿·입력값·수신자로 문서 생성, `send:true` 면 발송 |
| POST | /api/v1/documents/{id}/send | documents:send | 발송 요청 |
| GET | /api/v1/documents/{id} | documents:read | 진행 상태·참여자별 상태 |
| POST | /api/v1/documents/{id}/cancel | documents:cancel | 취소 요청 |
| GET | /api/v1/documents/{id}/history | documents:read | 처리 이력(감사 해시 포함) |
| GET | /api/v1/documents/{id}/pdf-url | files:read | 완료 PDF 다운로드 주소 (10분 뒤 만료) |

### 문서 생성 예
```bash
curl -X POST https://sign.example.kr/api/v1/documents \
  -H "Authorization: Bearer isk_예시키" -H "Idempotency-Key: ERP-PO-2026-000123" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": 4,
    "title": "협력업체 계약 - 예시전기",
    "values": { "partner": "예시전기(가상)", "site": "예시현장", "scope": "배관·입선", "amount": 10000000, "start_date": "2026-12-01", "end_date": "2027-03-31" },
    "participants": [
      { "role_key": "partner_rep", "name": "홍길동", "email": "ceo@example.com", "auth_method": "email_otp" },
      { "role_key": "company" }
    ],
    "send": true
  }'
```
- 외부 참여자: `name`, `email` 또는 `phone`, `auth_method`(`link`|`email_otp`|`phone_otp`)
- 직원 참여자: `user_id` / 직인 참여자: `role_key` 만

## 4. Webhook
이벤트: `document.sent`, `participant.signed`, `document.rejected`, `document.cancelled`, `document.expired`, `document.completed`

요청 본문:
```json
{ "id": "evt_…", "type": "participant.signed", "created_at": "2026-11-01 05:30:00", "data": { "documentId": 12, "participant": "협력업체 대표" } }
```
헤더: `X-IeumSign-Event-Id`, `X-IeumSign-Event`, `X-IeumSign-Timestamp`, `X-IeumSign-Signature: t=<초>,v1=<hex>`

서명 = HMAC-SHA256(비밀값, `"<t>.<원본 본문>"`). 받는 쪽은 반드시
1. 서명을 비교하고(시간 일정 비교), 2. 타임스탬프가 5분 이내인지 보고,
3. **이벤트 ID 로 중복을 걸러야** 합니다. 실패하면 10초·1분·5분·30분·2시간·6시간·12시간 간격으로 다시 보내므로 같은 이벤트가 두 번 올 수 있습니다.
2xx 로 빨리 응답하고 실제 처리는 뒤에서 하세요.

```js
// Node.js 수신 예 (express.raw 로 원본 본문을 받아야 함)
const crypto = require('crypto');
app.post('/ieumsign/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const [t, v1] = String(req.get('x-ieumsign-signature')).split(',').map((x) => x.split('=')[1]);
  const want = crypto.createHmac('sha256', process.env.IEUMSIGN_WEBHOOK_SECRET).update(`${t}.${req.body}`).digest('hex');
  if (!v1 || v1.length !== want.length || !crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(want))) return res.sendStatus(401);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.sendStatus(401);
  const ev = JSON.parse(req.body);
  if (alreadyHandled(ev.id)) return res.sendStatus(200);   // 중복 이벤트
  queueForProcessing(ev); res.sendStatus(200);
});
```

```python
# Python 수신 예
import hmac, hashlib, time
def verify(secret: str, header: str, raw: bytes) -> bool:
    parts = dict(p.split('=', 1) for p in header.split(','))
    want = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, parts.get('v1', '')) and abs(time.time() - int(parts['t'])) < 300
```
