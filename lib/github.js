'use strict';
/** GitHub 이슈 — 고객 수정 요청·전체 업데이트 요청을 저장소 이슈로 남긴다 (요청 대장의 원본) */
const API = 'https://api.github.com';

function client(token, repo, endpoint = API) {
  const call = async (method, path, json) => {
    const res = await fetch(`${endpoint}/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ss-license-portal' },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GitHub: ${body.message || `HTTP ${res.status}`}`);
    return body;
  };
  return {
    check: () => call('GET', ''),
    createIssue: (title, body, labels) => call('POST', '/issues', { title, body, labels }),
    getIssue: (number) => call('GET', `/issues/${number}`),
  };
}

/** 이슈 본문 — Claude가 새 대화에서 이슈만 읽고도 규칙대로 일하게 적는다 */
function issueBody({ customer, screen, now, want, deploy, modules }) {
  const head = customer
    ? `## 고객 맞춤 — ${customer.name} (${customer.bizRegNo})\n- 서버: ${customer.serverUrl || '(미개설)'}\n- 켜진 모듈: ${modules?.length ? modules.join(', ') : '없음(기본)'}\n`
    : '## SS-ERP 전체 업데이트\n';
  return `${head}
**화면** ${screen || '-'}
**지금** ${now || '-'}
**원하는 것**
${want}
**배포 범위** ${deploy}

---
규칙 (Claude에게): 코드는 sspower \`ss-erp\` 브랜치 하나. 고객별 차이는 ① 회사 설정값 ② 양식 파일 ③ 라이선스 모듈 스위치 순으로 고르고, 고객 전용 브랜치나 고객 서버 직접 수정은 하지 않는다. 끝나면 이 이슈에 어떤 방법으로 했는지, 모듈 이름이 있으면 그 이름을 댓글로 남기고 닫는다.`;
}

module.exports = { client, issueBody };
