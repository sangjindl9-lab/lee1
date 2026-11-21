# 스토어 등록 준비

## Google Play
- 패키지: `kr.eumsoft.notepro`, 앱 이름: 노트프로 / NotePro
- 개발자 계정: 이음소프트웨어(개인). 판매자 정보는 개인사업자 주소 사용(집 주소 비공개)
- 필요 권한 설명: 마이크(녹음 기능, 사용자가 녹음 버튼을 누를 때만), 인터넷(동기화·AI), 생체인증(잠금 노트)
- 데이터 보안 양식: docs/PRIVACY.md 1~2장 기준으로 작성
- 결제: 첫 출시는 무료. 구독을 켤 때 Play Billing 상품(`notepro_pro_monthly`) 생성 + 서버 영수증 검증(Google Play Developer API 서비스 계정) 설정 필요
- 서명: Play 앱 서명 사용. 업로드 키는 GitHub 저장소 비밀값 `NOTEPRO_KEYSTORE_B64`, `NOTEPRO_KEYSTORE_PASSWORD`, `NOTEPRO_KEY_ALIAS`, `NOTEPRO_KEY_PASSWORD` 로 넣으면 CI가 서명된 AAB를 만든다
- 비공개 테스트: 테스터 12명·14일 조건(도플리 등 활용)

## App Store (iOS 앱 개발 후)
- Apple 개발자 계정, StoreKit 구독, 개인정보 라벨, Sign in with Apple 필수(소셜 로그인 제공 시)
