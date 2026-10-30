'use strict';
/**
 * GitHub — 고객 수정 요청·전체 업데이트 요청을 저장소 이슈로 남기고,
 * 첨부 파일(양식·스크린샷)은 같은 저장소의 `requests` 브랜치에 올린다 (코드 브랜치 ss-erp 는 건드리지 않아 자동 배포가 일어나지 않음).
 */
const API = 'https://api.github.com';
const FILES_BRANCH = 'requests';

function client(token, repo, endpoint = API, baseBranch = 'ss-erp') {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'ss-license-portal' };
  const call = async (method, path, json, accept = 'application/vnd.github+json') => {
    const res = await fetch(`${endpoint}/repos/${repo}${path}`, {
      method, headers: { ...headers, accept }, body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(60_000),
    });
    if (accept.endsWith('.raw')) {
      if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`GitHub: ${body.message || `HTTP ${res.status}`}`), { status: res.status });
    return body;
  };
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  let branchReady = false;
  const ensureBranch = async () => {
    if (branchReady) return;
    try {
      await call('GET', `/git/ref/heads/${FILES_BRANCH}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      const base = await call('GET', `/git/ref/heads/${baseBranch}`);
      await call('POST', '/git/refs', { ref: `refs/heads/${FILES_BRANCH}`, sha: base.object.sha });
    }
    branchReady = true;
  };
  return {
    check: () => call('GET', ''),
    createIssue: (title, body, labels) => call('POST', '/issues', { title, body, labels }),
    getIssue: (number) => call('GET', `/issues/${number}`),
    updateIssue: (number, patch) => call('PATCH', `/issues/${number}`, patch),
    comments: (number) => call('GET', `/issues/${number}/comments?per_page=100`),
    addComment: (number, body) => call('POST', `/issues/${number}/comments`, { body }),
    /** 첨부 파일을 requests 브랜치에 커밋 */
    putFile: async (path, buffer, message) => {
      await ensureBranch();
      return call('PUT', `/contents/${enc(path)}`, { message, content: buffer.toString('base64'), branch: FILES_BRANCH });
    },
    getFile: (path) => call('GET', `/contents/${enc(path)}?ref=${FILES_BRANCH}`, null, 'application/vnd.github.raw'),
    fileLink: (path) => `https://github.com/${repo}/blob/${FILES_BRANCH}/${enc(path)}`,
  };
}

const TYPES = ['화면·기능 수정', '출력 양식', '새 기능', '계산·업무 규칙', '데이터 이관·정리', '오류 신고', '기타'];
const PRIORITIES = ['보통', '급함', '긴급(당일)'];
const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);

function fileLines(g, files) {
  return files.map((f) => (isImage(f.name) ? `![${f.name}](${g.fileLink(f.path)}?raw=true)` : `- [${f.name}](${g.fileLink(f.path)}) (${Math.ceil(f.size / 1024)}KB)`)).join('\n');
}

/** 이슈 본문 — Claude가 새 대화에서 이슈만 읽고도 규칙대로 일하게 적는다 */
function issueBody(g, { customer, type, priority, dueOn, screen, now, want, criteria, deploy, files, folder }) {
  const head = customer
    ? `## 고객 맞춤 — ${customer.name} (${customer.bizRegNo})\n- 서버: ${customer.serverUrl || '(미개설)'}\n`
    : '## 이음ERP 전체 업데이트\n';
  return `${head}
| 유형 | 우선순위 | 희망 반영일 | 배포 범위 |
|---|---|---|---|
| ${type} | ${priority} | ${dueOn || '-'} | ${deploy} |

### 화면
${screen || '-'}

### 지금
${now || '-'}

### 원하는 것
${want}

### 완료 기준 (이렇게 되면 끝)
${criteria || '-'}
${files.length ? `
### 첨부 (${files.length}개)
${fileLines(g, files)}

> 첨부 원본: \`${FILES_BRANCH}\` 브랜치 \`${folder}/\` — \`git fetch origin ${FILES_BRANCH} && git show origin/${FILES_BRANCH}:${folder}/파일명\`
` : ''}
---
규칙 (Claude에게): 코드는 sspower \`ss-erp\` 브랜치 하나. 고객별 차이는 ① 회사 설정값 ② 양식 파일 ③ 라이선스 모듈 스위치 순으로 고르고, 고객 전용 브랜치나 고객 서버 직접 수정은 하지 않는다. 첨부 양식이 있으면 그 양식과 똑같이 나오게 한다. 모호하면 추측하지 말고 이 이슈에 질문 댓글을 남긴다(요청 대장에서 답이 달린다). 끝나면 어떤 방법으로 했는지, 모듈 이름이 있으면 그 이름을 댓글로 남기고 닫는다.`;
}

module.exports = { client, issueBody, fileLines, TYPES, PRIORITIES, FILES_BRANCH };
