# 자동화 테스트 실행 결과

- 실행일: 2026-11-18 16:41:24 KST
- 런타임: Node v24.22.3 · PostgreSQL 18.6 · Prisma 6.19.3 · Vitest 3.2.7
- 데이터베이스: devvault_test (테스트 전용)

## 실행 명령
```
npm test
```

## 결과
```

 RUN  v3.2.7 /workspace/market-platform

 ✓ tests/01-access.test.ts > 필수 테스트 1. 결제하지 않은 사용자의 파일 접근 차단 > 결제 전 주문은 다운로드 티켓이 발급되지 않고 다운로드 기록도 남지 않는다 7749ms
 ✓ tests/01-access.test.ts > 필수 테스트 2. 타인 주문과 정산 정보 접근 차단 > 제3자는 주문 열람·다운로드·정산 요청을 할 수 없다 7714ms
 ✓ tests/01-access.test.ts > 필수 테스트 2. 타인 주문과 정산 정보 접근 차단 > 판매자는 구매자의 결제 정보를 정산 목적 외로 조작할 수 없다(판매자 지급 요청은 가능) 7702ms
 ✓ tests/01-access.test.ts > 필수 테스트 3. 결제 완료 후 파일 전달 실패 시 복구 > 저장소 장애로 전달이 실패해도 결제는 유지되고, 복구 후 같은 주문에서 다시 받을 수 있다 7656ms
 ✓ tests/01-access.test.ts > 필수 테스트 4. 빈 파일 및 누락 파일 납품 처리 > 빈 파일은 납품물로 등록할 수 없다 7400ms
 ✓ tests/01-access.test.ts > 필수 테스트 4. 빈 파일 및 누락 파일 납품 처리 > 누락 파일이 있는 상태로는 납품이 완료되지 않고 검수 기간도 시작되지 않는다 7418ms
 ✓ tests/01-access.test.ts > 필수 테스트 5. 계약과 다른 파일로 몰래 교체 시도 > 판매자가 새 버전을 올려도 기존 주문의 납품물 스냅샷은 바뀌지 않는다 7492ms
 ✓ tests/01-access.test.ts > 필수 테스트 6. 판매자 탈퇴 후 기존 구매 접근 > 판매자가 탈퇴해도 이미 결제한 주문의 납품물 접근은 유지된다 7632ms
 ✓ tests/01-access.test.ts > 필수 테스트 7. 미납품 상태의 검수·정산 차단 > 납품 전에는 검수 시작과 정산이 모두 차단된다 7489ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 8. 분쟁 중 지급 시도 > 분쟁이 접수되면 판매자 지급이 차단되고 외부 중지 요청 결과가 따로 기록된다 7460ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 9. 환불과 정산의 동시 실행 > 동시에 실행해도 한쪽만 진행되고 원장 잔액이 음수가 되지 않는다 7829ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 10. 중복·지연·역순 웹훅 > 같은 이벤트는 중복 반영되지 않고, 역순 이벤트는 상태를 되돌리지 않는다 7496ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 11. 외부 지급 요청 타임아웃 > 응답이 불명확하면 재요청하지 않고 조회로 확정하며, 지급은 한 번만 일어난다 7677ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 12. 부분 환불 미지원 결제수단 처리 > 부분 환불을 지원하지 않는 수단은 완료로 표시하지 않고 대체 절차를 안내한다 7914ms
 ✓ tests/02-settlement.test.ts > 필수 테스트 14. 환불 뒤 이미 다운로드한 파일의 처리 한계 표시 > 환불 후에는 추가 다운로드가 차단되고, 회수 불가 안내가 함께 제공된다 7692ms
 ✓ tests/03-policy.test.ts > 필수 테스트 13. 검수 기한과 외부 자동확정 일정 충돌 > 자동확정이 검수 기간보다 짧으면 결제를 막고, 충분하면 진행한다 7444ms
 ✓ tests/03-policy.test.ts > 필수 테스트 15. 디지털 콘텐츠 청약철회 제한 사전 동의 > 동의 없이는 결제가 시작되지 않고, 동의 시각·IP·버전이 기록된다 7463ms
 ✓ tests/03-policy.test.ts > 추가: 기정산 거래의 사후 환수 분리 > 이미 지급 완료된 거래의 환불은 일반 절차가 아닌 사후 환수로 접수된다 8285ms
 ✓ tests/03-policy.test.ts > 추가: 분쟁 판단은 AI 단독으로 불가 > AI가 판단을 시도하면 거부되고, 담당자 판단에는 근거·처리자·일시가 기록된다 8015ms
 ✓ tests/03-policy.test.ts > 추가: 대사(Reconciliation) > 내부 상태와 결제사업자 상태가 어긋난 건을 찾아낸다 7715ms

 Test Files  3 passed (3)
      Tests  20 passed (20)
   Start at  16:41:27
   Duration  159.89s (transform 750ms, setup 0ms, collect 847ms, tests 153.25s, environment 0ms, prepare 196ms)

```

## 빌드
```
├ ƒ /orders/[id]
├ ƒ /pay/[paymentId]
├ ƒ /products/[id]
├ ƒ /register
├ ƒ /requests
├ ƒ /requests/[id]
├ ƒ /requests/new
├ ƒ /seller/ip/[id]
├ ƒ /seller/ip/new
├ ƒ /seller/products/[id]
├ ƒ /seller/products/new
├ ƒ /solutions
├ ƒ /sources
├ ƒ /stores/[id]
├ ƒ /support
└ ƒ /trust


ƒ  (Dynamic)  server-rendered on demand

```
