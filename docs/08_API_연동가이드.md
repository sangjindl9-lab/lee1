# SS-ERP API 연동 가이드

외부 프로그램(그룹웨어, BI, 자체 시스템)이 SS-ERP 자료를 읽고 쓰는 방법입니다. 화면이 쓰는 것과 같은 REST API를 쓰므로, 화면에서 막히는 일은 API에서도 똑같이 막힙니다 (권한·결재·마감·금액 검증).

- 기본 주소: `https://<ERP_DOMAIN>/api/v1`
- 문서(OpenAPI/Swagger): `https://<ERP_DOMAIN>/api/docs` — 서버 설정 `SWAGGER_ENABLED=true` 일 때만 열립니다. 기계가 읽는 명세는 `/api/docs/openapi.json`.
- 모든 금액은 **문자열**(소수 2자리, 예: `"12500000.00"`)로 주고받습니다. 부동소수점 오차를 막기 위해서입니다.
- 날짜는 `YYYY-MM-DD` (한국시간 기준 업무일).

---

## 1. API 키

**관리 > API 키 > 키 발급** 에서 만듭니다 (권한: `apikey:create`, 기본 '관리자' 역할).

| 항목 | 설명 |
|---|---|
| 허용할 기능 | `자원:동작` 단위 (예: `vendor:read`, `purchase:create`). **발급하는 사람이 가진 권한 안에서만** 고를 수 있습니다 |
| 관리 기능 제외 | 회사·사용자·역할·감사로그·외부 연동·API 키·라이선스는 키로 접근할 수 없습니다 |
| 유효기간 | 30일·90일·1년·2년·무기한. 무기한은 권장하지 않습니다 |
| 허용 IP | 비우면 모든 IP. 고정 IP 서버에서 호출한다면 반드시 지정하세요 |

키 원문(`ssk_…`)은 **발급할 때 한 번만** 보여 줍니다. 서버에는 SHA-256 해시만 저장되어 관리자도 다시 볼 수 없습니다. 잃어버리면 폐기하고 새로 발급하세요.

**실제 권한 = 발급자의 현재 권한 ∩ 키 범위.** 발급자가 퇴사(계정 중지)하면 키도 즉시 막히고, 발급자의 역할이 줄면 키 권한도 같이 줄어듭니다. 키로 한 작업은 감사로그에 `발급자 이름 (API 키 이름)` 으로 남습니다.

### 요청 예

```bash
curl https://erp.example.co.kr/api/v1/vendors?q=전선 \
  -H "Authorization: Bearer ssk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

키는 발급한 회사의 자료에만 접근합니다. `x-company-id` 헤더는 필요 없습니다.

---

## 2. Idempotency-Key (중복 처리 방지) — POST 필수

네트워크 오류로 응답을 못 받으면 같은 요청을 다시 보내게 됩니다. 이때 거래처나 지급이 두 번 등록되지 않도록, API 키로 보내는 **모든 POST 요청에는 `Idempotency-Key` 헤더가 필수**입니다.

```bash
curl -X POST https://erp.example.co.kr/api/v1/vendors \
  -H "Authorization: Bearer ssk_…" \
  -H "Idempotency-Key: 6f1c2a9e-7b1d-4c55-9a0e-3f2b8d1e4c07" \
  -H "Content-Type: application/json" \
  -d '{"name":"㈜한빛전기","bizRegNo":"107-81-63213","vendorType":"SUPPLIER"}'
```

| 상황 | 결과 |
|---|---|
| 처음 보는 키 | 정상 처리, 응답을 저장 |
| 같은 키 + 같은 주소·내용으로 재전송 | **처리하지 않고** 처음 응답을 그대로 돌려줌 (같은 상태코드) |
| 같은 키 + 다른 내용 | `422 IDEMPOTENCY_KEY_REUSED` — 새 요청에는 새 키를 쓰세요 |
| 첫 요청이 아직 처리 중 | `409 IDEMPOTENCY_IN_PROGRESS` — 잠시 후 다시 |
| 키 없음 | `400 IDEMPOTENCY_KEY_REQUIRED` |
| 처리 중 오류(4xx·5xx) | 저장하지 않음 — 원인을 고친 뒤 같은 키로 다시 보내도 됩니다 |

키는 8~100자의 영문·숫자·`-_.:`. 요청마다 UUID를 새로 만들어 쓰는 것이 가장 쉽습니다. PUT·DELETE는 헤더가 선택이지만, 화면과 같은 `version`(낙관적 잠금) 검사를 하므로 두 번 보내도 두 번째는 `409 STALE_VERSION` 으로 거부됩니다.

---

## 3. 오류 형식

```json
{ "code": "VALIDATION_FAILED", "message": "입력값을 확인해 주세요", "fields": [{ "field": "bizRegNo", "message": "사업자등록번호 형식이 올바르지 않습니다" }] }
```

| HTTP | 의미 |
|---|---|
| 400 | 입력 오류 (`fields` 에 항목별 사유) |
| 401 | 키 없음·잘못됨·만료(`API_KEY_EXPIRED`)·허용 안 된 IP(`API_IP_DENIED`)·발급자 비활성 |
| 403 | 키 범위 밖(`API_SCOPE`), 키로 쓸 수 없는 기능(`API_NOT_ALLOWED` — 결재·관리 기능 등) |
| 404 | 없거나 다른 회사 자료 (존재 여부를 알려 주지 않음) |
| 409 | 상태 충돌 — 이미 처리됨, 다른 사람이 먼저 수정(`STALE_VERSION`), 결재 중 등 |
| 422 | Idempotency-Key 재사용 |
| 429 | 호출 한도 초과 (IP당 분당 300회) — 잠시 후 다시 |

`message` 는 사람에게 보여 줄 한국어 문장이고, 프로그램 분기는 `code` 로 하세요.

---

## 4. 자주 쓰는 엔드포인트

전체 목록과 입력 형식은 `/api/docs` 를 보세요. 아래는 연동에서 많이 쓰는 것입니다.

| 용도 | 메서드·경로 | 필요한 범위 |
|---|---|---|
| 현장 목록·상세 | `GET /projects`, `GET /projects/{id}` | `project:read` |
| 현장 손익 | `GET /project-pl/{projectId}` | `report:read` |
| 거래처 검색·등록 | `GET /vendors?q=`, `POST /vendors` | `vendor:read`, `vendor:create` |
| 발주서 목록·상세·PDF | `GET /purchase-orders`, `GET /purchase-orders/{id}`, `GET /purchase-orders/{id}/pdf` | `purchase:read` |
| 결재 대기 문서 | `GET /approvals?box=todo` | `approval:create` |
| 지급결의 | `GET /payment-requests` | `expense:read` |
| 세금계산서 | `GET /tax-invoices?direction=PURCHASE` | `taxinvoice:read` |
| 기성·미수금 | `GET /progress-claims`, `GET /collections/receivables` | `claim:read` |
| 통장 거래 업로드 | `POST /bank-transactions/import?bankAccountId=&dryRun=false` (multipart `file`) | `bank:create` |
| 자금일보 | `GET /cash/daily?date=` | `bank:read` |
| 보고서 | `GET /reports/{key}?format=json\|pdf\|xlsx&size=A4\|A3&orientation=auto\|portrait\|landscape` | 보고서별 권한 (+ 파일 출력은 `report:export`) |
| 전표 | `GET /journal-entries` | `journal:read` |

보고서 `key`: `project-pl`, `cost-statement`, `claims`, `receivables`, `vendor-balances`, `subcontracts`, `labor`, `cash-daily`, `cash-forecast`, `trial-balance`. `GET /reports` 가 내 키로 볼 수 있는 목록을 돌려줍니다.

목록 API는 `page`, `size`(최대 200~500) 로 나눠 받습니다. 응답의 `total` 로 전체 건수를 확인하세요.

### 결재는 API로 할 수 없습니다

발주서·지급결의·기성 등 **결재 승인·반려는 사람만** 합니다. API로는 문서를 만들고 상신할 수 있지만, 대표이사 결재를 키로 대신할 수 없습니다. 은행 이체 실행 기능도 없습니다 (지급은 사람이 은행에서 한 뒤 ERP에 '지급 처리').

---

## 5. 웹훅 — 업무가 일어나면 바로 알림 받기

**관리 > 웹훅 > 웹훅 등록** 에서 받을 주소와 이벤트를 고릅니다. 등록할 때 한 번 보여 주는 **비밀키(`whsec_…`)** 로 서명을 확인합니다.

### 이벤트 이름

감사로그의 `자원.동작` 을 소문자로 쓴 것입니다. `*` 는 전부, `purchase_order.*` 처럼 자원 단위로 고를 수 있습니다.

| 예 | 언제 |
|---|---|
| `purchase_order.submit` / `approval.approve` / `approval.reject` | 발주서 상신, 결재 승인·반려 |
| `payment_request.pay` | 지급 완료 |
| `tax_invoice.issue`, `tax_invoice.post` | 매출 계산서 발행, 매입 계산서 처리 |
| `claim.*` | 기성·수금 |
| `vendor.create`, `project.update` | 거래처 등록, 현장 수정 |
| `ping` | 화면의 '연결 테스트' |

### 요청 형식

```
POST <등록한 주소>
Content-Type: application/json
User-Agent: SS-ERP-Webhook/1.0
X-SSERP-Event: vendor.create
X-SSERP-Delivery: 1f0b…(발송 ID, 재시도해도 같음)
X-SSERP-Timestamp: 1792652400
X-SSERP-Signature: sha256=5c1a…

{"id":"1f0b…","event":"vendor.create","resource":"vendor","action":"CREATE","resourceId":"…","summary":"거래처 등록 ㈜한빛전기","actor":"김회계","occurredAt":"2026-10-22T06:10:00.000Z","companyId":"…"}
```

본문에는 **요약만** 들어 있습니다 (계좌번호·주민번호 같은 민감정보는 절대 넣지 않음). 상세가 필요하면 `resourceId` 로 API를 다시 조회하세요.

### 서명 확인 (받는 쪽에서 반드시)

```js
// Node.js (Express) — 본문을 '원문 그대로' 받아야 합니다
import crypto from 'node:crypto';
app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.header('x-sserp-timestamp');
  const sig = req.header('x-sserp-signature') ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.SSERP_WEBHOOK_SECRET).update(`${ts}.${req.body}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300; // 5분
  if (!fresh || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body);
  // X-SSERP-Delivery 로 이미 처리한 알림인지 확인 (같은 알림이 두 번 올 수 있음)
  res.sendStatus(200); // 10초 안에 2xx 로 답하고, 오래 걸리는 일은 따로 처리
});
```

```python
# Python (Flask)
import hmac, hashlib, time
@app.post('/hook')
def hook():
    ts = request.headers['X-SSERP-Timestamp']
    body = request.get_data()  # 원문 bytes
    expected = 'sha256=' + hmac.new(SECRET.encode(), f'{ts}.'.encode() + body, hashlib.sha256).hexdigest()
    if abs(time.time() - int(ts)) > 300 or not hmac.compare_digest(expected, request.headers.get('X-SSERP-Signature', '')):
        abort(401)
    return '', 200
```

### 전달 보장

- 업무와 **같은 트랜잭션**에서 발송 예정이 저장됩니다. 오류로 취소된 작업은 알림도 나가지 않고, 저장된 작업은 서버가 재시작돼도 알림이 남습니다.
- 2xx 이외의 응답·10초 초과·연결 실패면 1분 → 5분 → 30분 → 2시간 → 12시간 뒤 다시 보내고, 6번째도 실패하면 '실패'로 남깁니다. 화면에서 '다시 보내기' 할 수 있습니다.
- **같은 알림이 두 번 이상 올 수 있습니다** (받는 쪽이 처리했지만 응답이 늦은 경우). `X-SSERP-Delivery` 로 중복을 거르세요.
- 순서는 보장하지 않습니다. `occurredAt` 으로 판단하세요.
- 운영 환경에서는 `https` 주소만, 내부망(10.x, 192.168.x, 127.x 등) 주소는 등록할 수 없습니다 (SSRF 방지).

---

## 6. 보안 수칙

- 키는 연동 프로그램의 비밀 설정(환경변수·비밀 저장소)에만 두고 소스코드·메일·메신저에 붙이지 마세요.
- 용도마다 키를 따로 발급하세요. 하나가 새면 그것만 폐기하면 됩니다.
- **관리 > API 키** 의 '마지막 사용' 시각·IP를 월 1회 확인하고, 안 쓰는 키는 폐기하세요.
- 조회만 하는 연동에는 `:read` 범위만 주세요.
