# SS-ERP 외부 호출 중계 (relay)

ERP 서버가 공공데이터포털(apis.data.go.kr)에 직접 붙지 못할 때 대신 요청을 보내는 작은 서버입니다.

- 환경변수: `RELAY_TOKEN`(필수, 16자 이상), `ALLOWED_HOSTS`(쉼표 구분, 기본 apis.data.go.kr,api.odcloud.kr,infuser.odcloud.kr)
- ERP 쪽 설정: `OUTBOUND_RELAY_URL=https://<이 서버 주소>`, `OUTBOUND_RELAY_TOKEN=<같은 토큰>`
- 토큰이 맞고 허용된 호스트로 가는 요청만 중계합니다.
