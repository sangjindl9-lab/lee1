# 아키텍처 — 상태 모델·자금 흐름·납품물 흐름

## 1. 한 주문에 7개 상태

```
Order
├─ paymentStatus     결제      PENDING → AUTHORIZED → PAID ─→ REFUNDED / PARTIALLY_REFUNDED
├─ escrowStatus      대금보호  NOT_REQUESTED → REQUESTED → HELD → STOP_REQUESTED → STOPPED / RELEASED
├─ deliveryStatus    납품      NOT_DELIVERED → DELIVERED / INCOMPLETE / WITHDRAWN
├─ inspectionStatus  검수      NOT_STARTED → IN_PROGRESS → APPROVED / REVISION_REQUESTED / AUTO_CONFIRMED
├─ disputeStatus     분쟁      NONE → OPEN → EVIDENCE → NEGOTIATION → DECIDED / WITHDRAWN
├─ refundStatus      환불      NONE → REQUESTED → APPROVED → PROCESSING → COMPLETED / PARTIALLY_COMPLETED
│                             ↳ RECOVERY_REQUIRED(기정산) / UNSUPPORTED(수단 미지원) / REJECTED / FAILED
└─ payoutStatus      정산      NOT_ELIGIBLE → ELIGIBLE → REQUESTED → PROCESSING → PAID / FAILED / ON_HOLD
```

**불변식**
- 결제 `PAID` 없이 다운로드·검수·정산 불가
- 납품 `DELIVERED` 없이 검수·정산 불가
- 검수 `APPROVED|AUTO_CONFIRMED` 없이 정산 불가
- 분쟁 진행 중(`OPEN|EVIDENCE|NEGOTIATION`) 또는 환불 진행 중이면 정산 불가
- 같은 주문에 `Payout` 은 1건(`orderId @unique`), `PAYOUT_OUT` 원장 항목도 1건(`idempotencyKey @unique`)
- 7개 상태는 서로를 대체하지 않는다. (다운로드 ≠ 검수완료, 결제완료 ≠ 구매확정)

## 2. 자금 흐름 (완성형·소스코드 거래)

```
구매자 결제 ──▶ PG 승인(웹훅) ──▶ 내부 paymentStatus=PAID
                                    │
                                    ├─ 원장 PAYMENT_IN (결제금액)
                                    ├─ 원장 COMMISSION (플랫폼 수수료)
                                    ├─ 원장 PAYMENT_FEE (결제비용, 판매자 부담 시)
                                    └─ 원장 WITHHOLDING_TAX (개인 3.3%)

납품 → 검수 승인 → 정산 가능
판매자 지급 요청 ──▶ 원장 PAYOUT_OUT (주문 행 잠금 후) ──▶ PG 지급 ──▶ PAID
환불 완료        ──▶ 원장 REFUND_OUT (멱등 키) ──▶ 링크 회수 · 다운로드 차단
지급 실패        ──▶ 원장 ADJUSTMENT (차감 취소)
```

금액은 모두 **원 단위 정수**. 수수료는 `basis point`(1/10000)로 계산하고 내림 처리한다.

### 정산액 계산

```
commission   = floor(gross × (수수료율 - 할인) / 10000)
paymentFee   = floor(gross × 결제비용률 / 10000)   ← 판매자 부담일 때만 차감
withholding  = 개인 판매자 ? floor(gross × 3.3%) : 0
sellerNet    = gross - commission - paymentFee(판매자부담) - withholding
```

주문 시점 값이 `Order.snapshot.fee` 에 고정되므로, 이후 정책을 바꿔도 기존 주문은 변하지 않는다.

## 3. 납품물 흐름

```
판매자 업로드
  → safeDisplayName (경로·제어문자 제거)
  → scanDeliveryFile
       ├ ZIP: 중앙 디렉터리 직접 파싱 → 압축폭탄/경로탈출/심볼릭링크/암호화 검사
       └ 텍스트: 개인키·클라우드키·주민번호·카드번호·비밀번호 패턴 검사
  → AES-256-GCM 암호화 → VAULT_DIR/연/월/랜덤키
  → ProductFile (sha256, size, version, scanStatus, findings, uploadedBy)
  → 운영자 심사 → ACTIVE

구매
  → createOrder: 상품·파일·권리조건·수수료 → Order.snapshot + OrderFile 복사(고정)
  → 결제 웹훅(서명 검증) → PAID
  → issueDownload: 권한·결제·환불·분쟁 확인 + 저장소에서 읽어 해시 재검증
  → DownloadGrant(토큰 해시, 10분, 3회) → /api/downloads/[token]
  → redeemDownload: 만료·횟수·회수·상태 재확인 → DownloadEvent 기록
```

- 판매자가 이후 파일을 새 버전으로 올려도 기존 `OrderFile` 은 바뀌지 않는다.
- 저장 파일이 변조되면 해시 불일치로 **다운로드가 차단**되고 이벤트가 기록된다.
- 판매자 탈퇴 후에도 `OrderFile` 은 유지되어 구매자가 계속 받을 수 있다(운영 정책상 보관 기간은 별도 결정).

## 4. 결제·웹훅 처리

```
startPayment
  ├ 청약철회 동의 필수 → ConsentLog + Order.consent*
  ├ 검수기간 vs 결제수단 자동확정일 검증 (짧으면 결제 차단)
  └ Payment(AUTHORIZED) + PG 결제 생성

웹훅(POST /api/webhooks/mockpg)
  ├ 서명 검증(HMAC) 실패 → 401, 이벤트 기록(signatureValid=false)
  ├ eventId 중복 → DUPLICATE (상태 변경 없음)
  ├ eventTime < 마지막 처리 시각 → STALE_IGNORED (역순·지연)
  ├ payment.paid → Payment PAID, Order PAID, 보류 요청, 원장 기록
  ├ payment.failed/cancelled → 상태 반영
  └ escrow.stopped → 대금 보호 중지 반영
```

브라우저의 성공 화면만으로는 결제 상태를 바꾸지 않는다. `/pay/[paymentId]` 는 승인 버튼을 눌렀을 때
**서명된 웹훅을 서버 자신이 수신**하는 샌드박스이며, 실제 PG의 리다이렉트와 동일한 순서를 흉내 낸다.

## 5. 경쟁 상황 방어

| 상황 | 방어 |
| --- | --- |
| 환불 vs 지급 동시 | 두 함수 모두 `SELECT id FROM "Order" WHERE id=$1 FOR UPDATE` 후 상태 재확인 |
| 중복 지급 | `Payout.orderId @unique`, `LedgerEntry.idempotencyKey @unique` |
| 지급 응답 유실 | `PROCESSING` 유지 + 재요청 금지 + `getPayout` 조회로 확정 |
| 중복 웹훅 | `WebhookEvent @@unique(provider,eventId)` |
| 파일 교체 | 주문 스냅샷 해시 + 다운로드 시 해시 재검증 |
| 정책 변경 | 주문 스냅샷에 수수료·조건 고정 |
| 동시 상태 변경 | `Order.rowVersion` 증가(낙관적 잠금 표식) |

## 6. 맞춤 개발(단계별)

```
DevRequest → Quote(단계별 금액·산출물) → Contract(초안) → 양측 서명 → ACTIVE
  → ContractStage 별 Order 생성(CUSTOM_STAGE) → 결제 → 납품 → 검수 → 정산
  → ContractChange(금액·기간 변경) 양측 동의 → Contract.version 증가
```

- 이전 단계가 승인되지 않으면 다음 단계 주문을 만들 수 없다.
- 화면 캡처·시연 영상만으로 소스 납품 완료 처리하지 않는다(산출물 목록 기준).

## 7. 지식재산권

```
IpAsset(공개 소개) + IpVaultFile(비공개 자료)
  → NDA 동의(IpAccessGrant, 14일) → 자료 열람
  → createIpOrder → 독점 거래 시 IpAsset.status=EXCLUSIVE_LOCKED (중복 판매 차단)
  → 결제·자산 인도 → 권리 이전 절차는 계약 조건에 따름(플랫폼이 보증하지 않음)
```

## 8. 데이터 모델 요약

- **회원·조직**: `User`, `RoleAssignment`, `Company`, `CompanyMember`, `SellerProfile`
- **카탈로그**: `Product`, `ProductFile`, `ProductQuestion`, `Favorite`, `Review`
- **거래**: `Order`, `OrderFile`, `Payment`, `EscrowRecord`, `Delivery`, `InspectionRecord`,
  `Dispute`, `RefundRecord`, `Payout`, `LedgerEntry`, `DownloadGrant`, `DownloadEvent`, `ConsentLog`
- **운영**: `WebhookEvent`, `ReconciliationRun`, `ReconciliationIssue`, `AuditLog`, `SupportTicket`,
  `Notification`, `MessageThread`, `Message`, `FeePolicy`, `MockPgTx`
- **맞춤 개발**: `DevRequest`, `Quote`, `Contract`, `ContractStage`, `ContractChange`
- **지식재산권**: `IpAsset`, `IpVaultFile`, `IpAccessGrant`, `NdaAgreement`
