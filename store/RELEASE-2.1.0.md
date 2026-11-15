# 이음뷰어 2.1.0 제출 준비

패키지 kr.eumsoft.viewer, versionCode 14. 기존 Play Console 최대 코드와 업로드 키 일치는 제출 전에 확인한다.

추가 기능: 최근 문서 검색, PDF/CAD/즐겨찾기 필터, 즐겨찾기 우선 정렬, 즐겨찾기를 남기는 기록 삭제, PDF 텍스트 검색 후 해당 쪽 이동, 앱 내 개인정보처리방침.

## 제출 전 미완료 사항
- 기존 Play Console 앱 등록 여부, 기존 업로드 인증서, 배포 트랙 확인.
- 실제 업로드 키로 AAB 서명. debug.keystore는 공개 테스트 APK용이며 스토어 업로드 키로 사용하지 않는다. 키/암호는 채팅이나 Git에 올리지 않는다.
- 개인정보처리방침 HTML을 운영자의 공개 HTTPS 웹페이지에 게시하고 해당 URL을 Play Console에 입력한다.
- 광고 있음으로 신고. 데이터 보안은 광고 노출·클릭 집계 및 호스팅 접속 로그의 실제 수집·보관·삭제 설정을 운영자가 확인한 뒤 제출한다. 문서가 로컬 처리된다는 이유로 모든 데이터를 수집 안 함으로 신고하지 않는다.
- 스토어 스크린샷 갱신, 대상 연령·콘텐츠 등급·앱 액세스 설문 작성.
- 실제 Android 기기에서 SAF 열기/저장/공유, 한글 PDF, 큰 DWG, 회전·폴더블·태블릿, 오프라인 및 업데이트 설치 테스트.
- Play 사전 출시 보고서와 계정별 테스트 요건 통과 후 프로덕션 제출. 코드 빌드 성공은 심사 통과를 의미하지 않는다.

## 공식 확인 자료
- https://support.google.com/googleplay/android-developer/answer/9859455
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://support.google.com/googleplay/android-developer/answer/9842756
