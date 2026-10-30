'use strict';
/**
 * Railway 공개 API(GraphQL)로 고객 전용 이음ERP 서버를 만든다.
 *   고객마다 프로젝트 1개 = PostgreSQL + ERP 앱 + 첨부파일 저장공간 + 접속 주소
 * 각 단계의 결과(만든 ID)를 job.data 에 남겨, 실패하면 그 단계부터 다시 이어서 할 수 있다.
 */
const crypto = require('crypto');

const API = 'https://backboard.railway.com/graphql/v2';

function client(token, endpoint = API) {
  return async function gql(query, variables = {}) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('Railway 요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요');
    if (!res.ok || body.errors?.length) {
      const msg = body.errors?.map((e) => e.message).join(' / ') || `HTTP ${res.status}`;
      throw new Error(`Railway: ${msg}`);
    }
    return body.data;
  };
}

/** 영문 대·소문자·숫자·특수문자를 모두 넣은 임시 비밀번호 (ERP 비밀번호 정책 충족, 같은 문자 연속 없음) */
function tempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#%*-'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [...sets.map(pick)];
  while (chars.length < 14) {
    const c = pick(all);
    if (chars[chars.length - 1] !== c) chars.push(c);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const STEPS = [
  ['project', '프로젝트 만들기'],
  ['postgres', '데이터베이스 만들기'],
  ['app', 'ERP 서비스 만들기'],
  ['domain', '접속 주소 만들기'],
  ['postgresVolume', '데이터베이스 저장공간 연결'],
  ['appVolume', '첨부파일 저장공간 연결'],
  ['connect', '프로그램 설치 시작'],
  ['wait', '설치 완료 확인'],
];

/**
 * @param job  { data, secrets, input } — data 는 단계마다 채워짐
 * @param opts { gql, workspaceId, region, repo, branch, dockerfilePath, licenseServerUrl, onStep(step, data), sleep, waitTimeoutMs }
 */
async function provision(job, opts) {
  const { gql } = opts;
  const d = job.data;
  const s = job.secrets;
  const inp = job.input;
  const region = opts.region;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const mark = async (step) => opts.onStep?.(step, d);

  if (!d.projectId) {
    await mark('project');
    const r = await gql(
      `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id environments { edges { node { id name } } } } }`,
      { input: { name: inp.projectName, description: `이음ERP 고객 서버 — ${inp.companyName} (${inp.bizRegNo})`, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) } },
    );
    const envs = r.projectCreate.environments?.edges?.map((e) => e.node) ?? [];
    d.projectId = r.projectCreate.id;
    d.environmentId = (envs.find((e) => e.name === 'production') ?? envs[0])?.id;
    if (!d.environmentId) {
      const p = await gql(`query($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }`, { id: d.projectId });
      const list = p.project.environments.edges.map((e) => e.node);
      d.environmentId = (list.find((e) => e.name === 'production') ?? list[0]).id;
    }
  }
  const env = d.environmentId;

  if (!d.pgServiceId) {
    await mark('postgres');
    const pgUrl = `postgresql://postgres:${s.dbPassword}@\${{RAILWAY_PRIVATE_DOMAIN}}:5432/railway`;
    const r = await gql(`mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`, {
      input: {
        projectId: d.projectId,
        name: 'Postgres',
        source: { image: 'ghcr.io/railwayapp-templates/postgres-ssl:18' },
        variables: {
          POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: s.dbPassword, POSTGRES_DB: 'railway',
          PGUSER: 'postgres', PGPASSWORD: s.dbPassword, PGDATABASE: 'railway', PGPORT: '5432', PGHOST: '${{RAILWAY_PRIVATE_DOMAIN}}',
          PGDATA: '/var/lib/postgresql/data/pgdata', DATABASE_URL: pgUrl, SSL_CERT_DAYS: '820', RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '60',
        },
      },
    });
    d.pgServiceId = r.serviceCreate.id;
    await gql(`mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }`, {
      s: d.pgServiceId, e: env, input: { region, numReplicas: 1 },
    });
  }

  if (!d.appServiceId) {
    await mark('app');
    const r = await gql(`mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`, {
      input: {
        projectId: d.projectId,
        name: 'ss-erp',
        variables: {
          DATABASE_URL: '${{Postgres.DATABASE_URL}}',
          APP_ENCRYPTION_KEY: s.encryptionKey,
          PORT: '8080',
          COOKIE_SECURE: 'true',
          TRUST_PROXY: 'true',
          FILE_STORAGE_PATH: '/data/storage',
          RAILWAY_RUN_UID: '0',
          RAILWAY_DOCKERFILE_PATH: opts.dockerfilePath,
          INIT_COMPANY_NAME: inp.companyName,
          INIT_COMPANY_BIZNO: inp.bizRegNo,
          INIT_COMPANY_CODE: inp.companyCode,
          INIT_ADMIN_ID: inp.adminId,
          INIT_ADMIN_PASSWORD: s.adminPassword,
          LICENSE_SERVER_URL: opts.licenseServerUrl,
          LICENSE_ACTIVATION_CODE: inp.activationCode,
          // 첨부파일 공용 저장소(S3 버킷) — 고객마다 customers/<사업자번호>/ 폴더
          ...(opts.s3 ? {
            S3_ENDPOINT: opts.s3.endpoint, S3_BUCKET: opts.s3.bucket, S3_REGION: opts.s3.region || 'auto',
            S3_ACCESS_KEY_ID: opts.s3.accessKeyId, S3_SECRET_ACCESS_KEY: opts.s3.secretAccessKey, S3_PREFIX: `customers/${inp.bizRegNo}/`,
          } : {}),
          // 외부 백업(다른 지역) — 고객마다 customers/<사업자번호>/ 폴더
          ...(opts.backup ? {
            BACKUP_S3_ENDPOINT: opts.backup.endpoint, BACKUP_S3_BUCKET: opts.backup.bucket, BACKUP_S3_REGION: opts.backup.region || 'auto',
            BACKUP_S3_ACCESS_KEY_ID: opts.backup.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: opts.backup.secretAccessKey, BACKUP_S3_PREFIX: `customers/${inp.bizRegNo}/`,
          } : {}),
        },
      },
    });
    d.appServiceId = r.serviceCreate.id;
    await gql(`mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }`, {
      s: d.appServiceId, e: env,
      input: { region, numReplicas: 1, dockerfilePath: opts.dockerfilePath, healthcheckPath: '/api/v1/health', healthcheckTimeout: 300, restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 },
    });
  }

  if (!d.domain) {
    await mark('domain');
    const r = await gql(`mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain } }`, {
      input: { serviceId: d.appServiceId, environmentId: env, targetPort: 8080 },
    });
    d.domain = r.serviceDomainCreate.domain;
    await gql(`mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`, {
      input: { projectId: d.projectId, environmentId: env, serviceId: d.appServiceId, variables: { WEB_ORIGIN: `https://${d.domain}` }, skipDeploys: true },
    });
  }

  if (!d.pgVolumeId) {
    await mark('postgresVolume');
    const r = await gql(`mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`, {
      input: { projectId: d.projectId, serviceId: d.pgServiceId, environmentId: env, mountPath: '/var/lib/postgresql/data', region },
    });
    d.pgVolumeId = r.volumeCreate.id;
  }

  if (!d.appVolumeId) {
    await mark('appVolume');
    const r = await gql(`mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`, {
      input: { projectId: d.projectId, serviceId: d.appServiceId, environmentId: env, mountPath: '/data', region },
    });
    d.appVolumeId = r.volumeCreate.id;
  }

  if (!d.connected) {
    await mark('connect');
    await gql(`mutation($id: String!, $input: ServiceConnectInput!) { serviceConnect(id: $id, input: $input) { id } }`, {
      id: d.appServiceId, input: { repo: opts.repo, branch: opts.branch },
    });
    d.connected = true;
  }

  await mark('wait');
  const deadline = Date.now() + (opts.waitTimeoutMs ?? 25 * 60_000);
  let triggered = !!d.redeployed;
  while (Date.now() < deadline) {
    const r = await gql(
      `query($input: DeploymentListInput!) { deployments(input: $input, first: 1) { edges { node { id status } } } }`,
      { input: { projectId: d.projectId, serviceId: d.appServiceId, environmentId: env } },
    );
    const st = r.deployments.edges[0]?.node?.status;
    if (st === 'SUCCESS') return d;
    if (['FAILED', 'CRASHED'].includes(st)) {
      // 데이터베이스가 늦게 떠서 첫 시작이 실패하는 경우가 있어 한 번은 자동으로 다시 배포한다
      if (!triggered) {
        triggered = true;
        d.redeployed = true;
        await gql(`mutation($s: String!, $e: String!) { serviceInstanceRedeploy(serviceId: $s, environmentId: $e) }`, { s: d.appServiceId, e: env });
      } else {
        throw new Error('ERP 설치(배포)에 실패했습니다. Railway 대시보드의 배포 로그를 확인해 주세요');
      }
    }
    await sleep(15_000);
  }
  throw new Error('설치 확인 시간이 초과됐습니다. 잠시 뒤 다시 시도를 누르면 상태를 다시 확인합니다');
}

/** 고객 서버가 ss-erp 에 push 될 때마다 자동 배포되지 않게 — 존재하지 않는 경로만 감시하게 해서 버전 배포로만 바뀌게 한다 */
const LOCK_PATTERN = '.eum-release-only';
async function lockAutoDeploy(gql, d) {
  await gql(`mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }`, {
    s: d.appServiceId, e: d.environmentId, input: { watchPatterns: [LOCK_PATTERN] },
  });
}

/** 정해진 버전(커밋)으로 고객 서버 배포. 화면에 보일 버전 이름도 함께 넣는다 */
async function deployVersion(gql, d, version, commitSha) {
  await lockAutoDeploy(gql, d);
  await gql(`mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`, {
    input: { projectId: d.projectId, environmentId: d.environmentId, serviceId: d.appServiceId, variables: { APP_VERSION: version }, skipDeploys: true },
  });
  await gql(`mutation($s: String!, $e: String!, $c: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e, commitSha: $c) }`, { s: d.appServiceId, e: d.environmentId, c: commitSha });
}

/** 우리 ERP(개발 서버)에 성공적으로 배포된 커밋들 — 최신순 */
async function sourceDeploys(gql, src, first = 50) {
  const r = await gql(`query($input: DeploymentListInput!, $n: Int) { deployments(input: $input, first: $n) { edges { node { id status createdAt meta } } } }`,
    { input: { projectId: src.projectId, serviceId: src.serviceId, environmentId: src.environmentId }, n: first });
  return r.deployments.edges.map((e) => e.node);
}

module.exports = { client, provision, tempPassword, STEPS, lockAutoDeploy, deployVersion, sourceDeploys };
