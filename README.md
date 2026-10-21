# 전기·통신 예정공정표

전기공사·정보통신공사용 웹 기반 예정공정표 / 보할공정표 관리 프로그램 (React + TypeScript + Vite + Tailwind).

## 실행

```bash
npm install
npm run dev            # 개발 서버 (http://localhost:5173)
npm test               # 계산 엔진 테스트 (윤년·연도 경계·기간 구분·보할·예정/실적·재계산)
npm run build          # 정적 웹사이트 → dist/ (Render Static Site, Netlify 등에 그대로 배포)
npm run build:single   # 파일 하나짜리 → dist-single/index.html (더블클릭으로 실행 가능)
```

Render 정적 사이트 배포: Build Command `npm install && npm run build`, Publish Directory `dist`.

## 기능

- 공사정보 입력 → 착공·준공일로 공사일수 자동 계산, [공정표 자동 생성] (전기 / 정보통신 / 통합 템플릿, 생성 비율 수정 가능)
- 공사기간 변경 시 비례 재계산 확인 (직접 수정한 일정 보호 / 전체 / 새로 생성 / 유지)
- 월별·주별(월~일, 부분 주 처리)·20일 단위(착공일 기준) 간트 전환 — 데이터는 그대로
- 예정 막대(파랑), 실적 달성률(초록·지연 빨강·완료 진한 초록), 실제 착수~완료 막대, 기준일 선, 마우스 툴팁, 막대 드래그로 이동·기간 조정
- 보할: 직접 입력 / 공사비 산정(공종 공사비 ÷ 합계 × 100), 합계 100% 검증·비례조정, 임시값 표시·확정, 상위·하위 공종 중복 없이 합산
- 예정공정률: 작업일 선형(전체 달력일 / 주말 제외 / 지정 휴무일 제외), 공종별 기간 계획 진도율 수동 설정
- 실제공정률: Σ(보할 × 실적)/100, 편차(%p)와 지연/정상/선행 상태 즉시 갱신
- 기준일별 실적 이력 저장·조회·수정·삭제 → 누적 실적 곡선(이력 없는 구간은 '데이터 없음')
- S-Curve(누적 예정·실적, 편차 음영), 기간별 예정·실적 누계
- 공종 추가·삭제·이름·순서·들여쓰기(하위 공종)·색상·메모, 실행취소/재실행(Ctrl+Z / Ctrl+Y)
- Excel: 현재 단위 반영, 계획/실적 2행 막대, 기간별 보할 반영값, 합계 수식, 보할표·누적공정률·실적이력 시트
- PDF: A3 가로(기본)/A4 가로, 개요·결재란·문서번호, 기간·공종 자동 페이지 분할, 마지막 장 S-Curve·특이사항
- 장기계속공사: 총차 예정공정표 + 차수별(1차·2차…) 예정공정표 — 총차에서 차수 자동 생성(기간 몫 보할 100% 환산), 차수 탭 전환, 차수 현황표(금액 비율·총차 예정 몫·총차 환산 실적), 총차 양식에 차수 구분 표시
- 다중 프로젝트(검색·복제·삭제), 자동 저장(localStorage), JSON 백업/복원

## 구조

```
src/lib/types.ts        데이터 모델 (JSON 문서 그대로 DB 저장 가능)
src/lib/date.ts         시간대 무관 달력 날짜 연산, KST 오늘
src/lib/calc.ts         작업일 달력·공종 트리·예정/실적·기간 구분·누계 계산
src/lib/schedule.ts     기본 템플릿·자동 생성·비례 재계산·예시 프로젝트
src/lib/taskOps.ts      공종 편집 연산
src/lib/phases.ts       장기계속공사 총차·차수 연결과 차수 생성
src/lib/storage.ts      저장소 인터페이스(ProjectStore) + LocalStore / 클라우드 어댑터
src/lib/exportExcel.ts  Excel 출력 (ExcelJS)
src/lib/exportPdf.ts    PDF 출력 (캔버스 렌더링 + jsPDF, 한글 깨짐 없음)
src/state/useProjects.ts 프로젝트 상태·자동 저장·실행취소
src/components/*        화면 구성 요소
```

로그인·클라우드 DB·직원별 권한은 `ProjectStore` 인터페이스를 구현한 어댑터(예: Firebase/Supabase)를 `createStore()`에 추가하면 화면 코드 수정 없이 붙일 수 있습니다.
