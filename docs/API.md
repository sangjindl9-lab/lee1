# API (요약)
모든 경로는 `/api` 접두사. 인증은 로그인 시 받는 `eum3d_session` 쿠키(또는 `Authorization: Bearer`). 오류는 `{ "error": "메시지" }`.

## 인증·사용자
| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | /auth/signup | `{companyName,name,email,password}` 회사+관리자 생성 |
| POST | /auth/login · /auth/logout | |
| GET | /auth/me | 사용자·회사 |
| GET/POST | /auth/users | (관리자) 사용자 목록·추가 `{email,name,password,role}` |
| GET | /auth/audit | (관리자) 감사 로그 300건 |

## 프로젝트·업로드·파일
| GET/POST | /projects | 목록 / 생성 `{name,industry: mold|machine|electric|building|product,description}` |
| GET/PATCH/DELETE | /projects/:id | 상세(파일·모델·작업) / 수정 / 삭제(관리자) |
| POST | /projects/:id/uploads | `{name,size}` → `{uploadId,chunkSize}` |
| PUT | /uploads/:id/chunks/:index | 바이너리 조각(순서대로) |
| POST | /uploads/:id/complete | 검사·원본 저장·변환 작업 등록 → `{file,job}` |
| GET | /files/:id | 파일·분석 결과 |
| GET | /files/:id/original | 원본 다운로드(관리자·사용자, 감사 기록) |
| POST | /files/:id/extrude | DXF·DWG·PDF → 3D `{thickness (필수), scale (PDF 필수, 1:N 의 N), profiles?, perProfile?, name?}` |
| GET | /files/:id/preview | PDF 1쪽 미리보기 PNG |
| GET | /jobs/:id · POST /jobs/:id/retry | 작업 상태 / 실패 작업 재시도 |

## 모델·장면·영상
| GET | /models/:id | 모델(부품 트리·통계·형상근거) + 최신 장면 |
| GET | /models/:id/glb | 시각화 GLB |
| PUT | /models/:id/scene | `{data}` 저장 → 새 버전 |
| GET | /models/:id/scenes | 저장 버전 목록 |
| POST | /models/:id/renders | `{quality: hd|fhd|qhd|4k, fps: 24|30|60}` → render 작업 |
| GET | /models/:id/videos | 영상 목록 |
| GET | /videos/:id/file[?download=1] · /videos/:id/thumb | MP4(Range 지원)·썸네일 |

## 공유
| POST | /models/:id/shares | `{title?,password?,expiresAt?}` → `{url,token,…}` |
| GET | /projects/:id/shares | 목록(방문수 포함) |
| PATCH | /shares/:id | `{revoke?,password?,expiresAt?,title?}` |
| POST | /shares/:id/reissue | 기존 폐기 + 새 토큰 |
| GET | /shares/:id/qr.png · qr.svg · visits | QR / 방문 기록 |
| GET | /public/shares/:token | (비로그인) 쇼룸 데이터. 비밀번호 필요 시 401 `needsPassword` |
| POST | /public/shares/:token/unlock | `{password}` → 쿠키 + `passToken`(헤더 `x-share-pass`) |
| GET | /public/shares/:token/model.glb | (비로그인) GLB |

## 장면 데이터(scene.data) 구조
```json
{ "title": "제품명", "viewMode": "showroom|technical", "background": "studio|dark|white|factory",
  "parts": { "P0001": { "label": "표시명", "color": "#hex", "opacity": 0.5, "hidden": true, "desc": "설명",
                         "explode": { "dir": [0,0,1], "dist": 120, "step": 1 } } },
  "explode": { "factor": 1 }, "camera": { "position": [], "target": [], "fov": 35 } | null,
  "overlay": { "subtitle": "", "watermark": "" },
  "animation": { "clips": [ { "type": "hold|explode|assemble|turntable", "duration": 4, "degrees": 360 } ] } }
```
좌표·거리 단위는 모델 단위(STEP/DXF/STL = mm), 방향은 CAD 좌표계(Z-up).
