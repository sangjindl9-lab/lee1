#!/usr/bin/env node
/**
 * 실서버 HTTP 스모크 테스트.
 *
 * - 별도 SQLite(smoke.db)와 스토리지로 시드한 뒤 next start 를 띄운다.
 * - 필수 시나리오 6가지를 실제 HTTP 로 검증한다.
 *
 * 실행: npm run smoke   (먼저 npm run build 가 필요하다)
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 3221);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_URL = "file:./smoke.db";
const STORAGE = "./test-storage/smoke";

const results = [];
let cookie = "";

function check(name, condition, detail = "") {
  const passed = Boolean(condition);
  results.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) process.exitCode = 1;
  return passed;
}

async function req(pathname, { method = "GET", body, headers = {}, raw = false, redirect = "follow", useCookie = cookie } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { ...(useCookie ? { cookie: useCookie } : {}), ...headers },
    body,
    redirect,
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  let json = null;
  let text = "";
  if (raw) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buffer: buf, json: null, text: "", setCookies, url: res.url };
  }
  text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text, setCookies, url: res.url };
}

async function login(email, password = "demo1234") {
  const res = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    useCookie: "",
  });
  const cookieHeader = res.setCookies.map((c) => c.split(";")[0]).join("; ");
  return { res, cookie: cookieHeader };
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

function kstDate(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function waitForServer(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

async function main() {
  console.log("▶ 스모크 DB 준비");
  execFileSync("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "pipe",
  });
  fs.rmSync(path.join(ROOT, STORAGE), { recursive: true, force: true });
  execFileSync("node", ["--env-file=.env", "--import", "tsx", "prisma/seed.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL, STORAGE_ROOT: STORAGE },
    stdio: "pipe",
  });

  console.log(`▶ next start :${PORT}`);
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      STORAGE_ROOT: STORAGE,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d.toString()));
  server.stderr.on("data", (d) => (serverLog += d.toString()));

  try {
    if (!(await waitForServer())) throw new Error(`서버가 뜨지 않았습니다.\n${serverLog}`);

    // ── 로그인
    const dadLogin = await login("dad@demo.family");
    cookie = dadLogin.cookie;
    check("부모 계정 로그인", dadLogin.res.status === 200 && Boolean(cookie), `status=${dadLogin.res.status}`);
    const dadMe = await req("/api/auth/me");
    check("로그인 세션 확인", dadMe.json?.user?.role === "PARENT", dadMe.json?.user?.name);

    // ── 페이지 렌더
    for (const [label, pathname] of [
      ["홈", "/app"],
      ["업로드", "/app/upload"],
      ["검색", "/app/search"],
      ["육아기록", "/app/care"],
      ["설정", "/app/settings"],
      ["구매", "/app/settings/purchase"],
      ["휴지통", "/app/trash"],
    ]) {
      const res = await req(pathname);
      check(`부모 화면 ${label}`, res.status === 200 && res.text.includes("가족앨범"), `status=${res.status}`);
    }

    // ── 아이/앨범 정보
    const childrenRes = await req("/api/children");
    const children = childrenRes.json?.children ?? [];
    const jiwoo = children.find((c) => c.name === "지우");
    const seojun = children.find((c) => c.name === "서준");
    check("아이 2명·앨범 조회", children.length === 2 && Boolean(jiwoo?.albums?.[0]?.id), `${children.map((c) => c.name).join(", ")}`);
    const jiwooAlbum = jiwoo.albums[0];
    const beforeAlbum = await req(`/api/album?childId=${jiwoo.id}`);
    const beforeCount = beforeAlbum.json?.items?.length ?? 0;

    // ─────────────────────────────────────────────── 시나리오 1: 업로드
    console.log("\n▶ 시나리오 1 · 100장 업로드, 부분 실패, 재시도, 중복 방지, 세션 복원");
    const photoCount = 100;
    const files = [];
    for (let i = 0; i < photoCount; i += 1) {
      const hue = (i * 53) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="hsl(${hue},75%,72%)"/><text x="60" y="50" font-size="18" text-anchor="middle" fill="#111">${i + 1}</text></svg>`;
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
      files.push({ clientFileId: `smoke-photo-${i}`, fileName: `smoke_${String(i).padStart(3, "0")}.jpg`, mimeType: "image/jpeg", buffer });
    }
    const videoHead = Buffer.from("000000206674797069736F6D", "hex");
    const videoBuffer = Buffer.concat([videoHead, Buffer.alloc(180 * 1024, 7)]);
    files.push({ clientFileId: "smoke-video", fileName: "smoke_video.mp4", mimeType: "video/mp4", buffer: videoBuffer });

    const sessionRes = await req("/api/uploads/sessions", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        childId: jiwoo.id,
        albumId: jiwooAlbum.id,
        visibility: "FAMILY",
        files: files.map((f) => ({ clientFileId: f.clientFileId, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.buffer.byteLength })),
      }),
    });
    const sessionId = sessionRes.json?.session?.id;
    check("업로드 세션 생성", sessionRes.status === 200 && Boolean(sessionId), `total=${sessionRes.json?.session?.totalFiles}`);
    const itemByClient = new Map((sessionRes.json?.items ?? []).map((i) => [i.clientFileId, i.id]));

    const failIndexes = new Set([5, 44, 77]);
    let failed = 0;
    let done = 0;
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const form = new FormData();
      form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
      form.append("capturedAt", new Date("2026-04-22T18:05:00+09:00").toISOString());
      const headers = {};
      if (failIndexes.has(i)) headers["x-simulate-fail"] = "1";
      const res = await req(`/api/uploads/${sessionId}/items/${itemByClient.get(file.clientFileId)}`, {
        method: "POST",
        body: form,
        headers,
      });
      if (res.status === 200 && res.json?.item?.status === "DONE") done += 1;
      else failed += 1;
    }
    check("101개 중 98개 완료 · 3개 실패", done === 98 && failed === 3, `done=${done}, failed=${failed}`);

    const afterPartial = await req(`/api/uploads/${sessionId}`);
    check(
      "결과 요약 '101개 중 98개 완료, 3개 재시도'",
      afterPartial.json?.summary?.text === "101개 중 98개 완료, 3개 재시도",
      afterPartial.json?.summary?.text,
    );

    const latest = await req("/api/uploads/latest");
    const restoredItems = latest.json?.latest?.items ?? [];
    check(
      "앱 재실행(세션 복원) 시 상태 유지",
      restoredItems.length === 101 &&
        restoredItems.filter((i) => i.status === "FAILED").length === 3 &&
        restoredItems.filter((i) => i.status === "DONE").length === 98,
      `restored=${restoredItems.length}`,
    );

    for (const i of [...failIndexes]) {
      const file = files[i];
      const form = new FormData();
      form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
      const res = await req(`/api/uploads/${sessionId}/items/${itemByClient.get(file.clientFileId)}`, { method: "POST", body: form });
      if (res.status !== 200) check(`재시도 ${file.fileName}`, false, res.text.slice(0, 120));
    }
    const afterRetry = await req(`/api/uploads/${sessionId}`);
    check(
      "실패한 항목만 재시도 후 모두 완료",
      afterRetry.json?.summary?.done === 101 && afterRetry.json?.summary?.failed === 0,
      afterRetry.json?.summary?.text,
    );

    const albumAfter = await req(`/api/album?childId=${jiwoo.id}`);
    const afterCount = albumAfter.json?.items?.length ?? 0;
    check("앨범에 101개 저장", afterCount === beforeCount + 101, `${beforeCount} → ${afterCount}`);

    // 같은 파일을 새 세션으로 다시 업로드 → 중복 등록 없음
    const dupeSession = await req("/api/uploads/sessions", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        childId: jiwoo.id,
        albumId: jiwooAlbum.id,
        visibility: "FAMILY",
        files: files.slice(0, 3).map((f) => ({ clientFileId: `dupe-${f.clientFileId}`, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.buffer.byteLength })),
      }),
    });
    const dupeItems = dupeSession.json?.items ?? [];
    let dupFlags = 0;
    for (let i = 0; i < 3; i += 1) {
      const file = files[i];
      const form = new FormData();
      form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
      const res = await req(`/api/uploads/${dupeSession.json.session.id}/items/${dupeItems[i].id}`, { method: "POST", body: form });
      if (res.json?.item?.duplicate) dupFlags += 1;
    }
    const albumAfterDupe = await req(`/api/album?childId=${jiwoo.id}`);
    check(
      "이미 저장된 파일 재업로드 시 중복 등록 없음",
      dupFlags === 3 && (albumAfterDupe.json?.items?.length ?? 0) === afterCount,
      `duplicate=${dupFlags}, count=${albumAfterDupe.json?.items?.length}`,
    );

    // ─────────────────────────────────────────────── 다운로드
    console.log("\n▶ 원본 다운로드");
    const mediaList = albumAfterDupe.json?.items ?? [];
    const oneImage = mediaList.find((m) => m.kind === "IMAGE" && m.fileName.startsWith("smoke_"));
    const oneVideo = mediaList.find((m) => m.kind === "VIDEO");
    const single = await req(`/api/media/${oneImage.id}/download`, { raw: true });
    check("단일 원본 다운로드", single.status === 200 && single.buffer.length > 0, `${single.buffer.length} bytes · ${single.headers.get("content-type")}`);
    check("동영상 원본·미리보기 화질 분리 표기", oneVideo?.originalQuality?.includes("1080p") && oneVideo?.previewQuality?.includes("720p"), `${oneVideo?.previewQuality} / ${oneVideo?.originalQuality}`);

    const zip = await req(`/api/download?mediaIds=${oneImage.id},${oneVideo.id}`, { raw: true });
    const zipOk = zip.status === 200 && zip.buffer.length > 0 && zip.buffer.subarray(0, 2).toString() === "PK";
    check("선택 원본 ZIP 다운로드", zipOk, `status=${zip.status}, ${zip.buffer.length} bytes`);

    const periodZip = await req(`/api/download?childId=${jiwoo.id}&from=2026-04-01&to=2026-04-30`, { raw: true });
    check("기간 원본 ZIP 다운로드", periodZip.status === 200 && periodZip.buffer.subarray(0, 2).toString() === "PK", `${periodZip.buffer.length} bytes`);

    // ─────────────────────────────────────────────── 시나리오 2: 휴지통 복구
    console.log("\n▶ 시나리오 2 · 휴지통 복구(원래 아이/앨범/촬영일/공개범위 유지)");
    const beforeMedia = await req(`/api/media/${oneImage.id}`);
    const original = beforeMedia.json?.media;
    const del = await req(`/api/media/${oneImage.id}`, { method: "DELETE" });
    check("삭제 시 휴지통 이동", del.status === 200 && del.json?.media?.deletedAt !== null);
    const trash = await req("/api/trash");
    check("휴지통 목록에 표시", (trash.json?.items ?? []).some((m) => m.id === oneImage.id));
    const restore = await req(`/api/media/${oneImage.id}/restore`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ childId: seojun.id, albumId: seojun.albums[0].id }),
    });
    check(
      "다른 아이를 지정해도 원래 아이 앨범으로 복구",
      restore.json?.restoredTo?.childId === jiwoo.id &&
        restore.json?.restoredTo?.albumId === jiwooAlbum.id &&
        restore.json?.ignoredRequest?.childId === seojun.id,
      `restored child=${restore.json?.restoredTo?.childId}`,
    );
    check(
      "복구 후 촬영일·공개범위 유지",
      restore.json?.media?.capturedAt === original?.capturedAt &&
        restore.json?.media?.visibility === original?.visibility,
      `${restore.json?.media?.capturedAt} / ${restore.json?.media?.visibility}`,
    );
    const seojunAlbumAfter = await req(`/api/album?childId=${seojun.id}`);
    check("다른 아이 앨범에는 들어가지 않음", !(seojunAlbumAfter.json?.items ?? []).some((m) => m.id === oneImage.id));

    // ─────────────────────────────────────────────── 시나리오 3: 광고 제거
    console.log("\n▶ 시나리오 3 · 결제·구매 복원·일일 1회 광고");
    const ad1 = await req("/api/ads/next?slot=today");
    const ad2 = await req("/api/ads/next?slot=today");
    check("하루 1회 광고 노출", ad1.json?.show === true && ad2.json?.show === false && ad2.json?.reason === "DAILY_LIMIT_REACHED", `${ad1.json?.reason} → ${ad2.json?.reason}`);

    const purchase = await req("/api/billing/purchase", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ productId: "adfree.family.monthly", platform: "WEB_MOCK" }),
    });
    check("가족 전체 상품 결제", purchase.status === 200 && purchase.json?.entitlement?.adFree === true && purchase.json?.entitlement?.coversFamily === true);
    const ad3 = await req("/api/ads/next?slot=today");
    check("결제 후 광고 미노출", ad3.json?.show === false && ad3.json?.reason === "AD_FREE");

    const restorePurchase = await req("/api/billing/restore", { method: "POST", headers: jsonHeaders(), body: "{}" });
    check("구매 복원", restorePurchase.status === 200 && restorePurchase.json?.restored >= 1 && restorePurchase.json?.entitlement?.adFree === true, `restored=${restorePurchase.json?.restored}`);
    const recheck = await req("/api/billing/recheck", { method: "POST" });
    check("결제 상태 재확인", recheck.status === 200 && recheck.json?.verified === true, `impressions=${recheck.json?.adImpressionsToday}`);
    const storeBlocked = await req("/api/billing/purchase", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ productId: "adfree.family.monthly", platform: "GOOGLE_PLAY" }),
    });
    check("스토어 미연동 결제는 명확한 안내로 거절", storeBlocked.status === 409, storeBlocked.json?.error?.message);

    const inquiry = await req("/api/inquiries", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ message: "결제했는데 업로드 화면 광고가 아직 보입니다. 확인 부탁드려요." }),
    });
    check("문의 DB 접수", inquiry.status === 200 && Boolean(inquiry.json?.inquiry?.id), inquiry.json?.inquiry?.status);

    // ─────────────────────────────────────────────── 시나리오 4: 수면
    console.log("\n▶ 시나리오 4 · 자정 넘긴 수면 기록");
    const yDay = kstDate(-1);
    const tDay = kstDate(0);
    const sleep = await req("/api/care/sleep", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ childId: jiwoo.id, startDate: yDay, startTime: "23:40", endDate: tDay, endTime: "01:10" }),
    });
    check(
      "23:40 → 01:10 = 1시간 30분",
      sleep.status === 200 && sleep.json?.record?.durationMinutes === 90 && sleep.json?.record?.durationLabel === "1시간 30분" && sleep.json?.record?.overnight === true,
      sleep.json?.record?.durationLabel,
    );

    const ongoing = await req("/api/care/sleep", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ childId: jiwoo.id, startDate: tDay, startTime: "00:20", ongoing: true }),
    });
    check("수면 시작만 저장(수면 중)", ongoing.status === 200 && ongoing.json?.record?.status === "ONGOING");
    const ended = await req(`/api/care/sleep/${ongoing.json?.record?.id}/end`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ endDate: tDay, endTime: "01:50" }),
    });
    check("수면 중 기록 종료 입력", ended.status === 200 && ended.json?.record?.durationMinutes === 90, ended.json?.record?.durationLabel);

    const badSleep = await req("/api/care/sleep", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ childId: jiwoo.id, startDate: tDay, startTime: "23:40", endDate: yDay, endTime: "01:10" }),
    });
    check(
      "잘못된 입력은 필드별 오류",
      badSleep.status === 422 && Boolean(badSleep.json?.fieldErrors?.endDate) && !badSleep.json?.fieldErrors?.endTime,
      JSON.stringify(badSleep.json?.fieldErrors),
    );
    const careList = await req(`/api/care?childId=${jiwoo.id}`);
    check("수면·수유 기록 조회", Array.isArray(careList.json?.records) && careList.json.records.length > 0, `${careList.json?.records?.length}건`);

    // ─────────────────────────────────────────────── 시나리오 5: 검색
    console.log("\n▶ 시나리오 5 · 생후 개월·태그 검색");
    const search = await req(`/api/search?q=${encodeURIComponent("둘째 생후 10개월 때 찍은 동영상")}`);
    const searchItems = search.json?.items ?? [];
    check(
      "'둘째 생후 10개월 동영상' 조건 검색",
      search.status === 200 &&
        searchItems.length >= 1 &&
        searchItems.every((i) => i.kind === "VIDEO" && i.ageMonths === 10 && i.childName === "지우") &&
        searchItems.some((i) => i.fileName.includes("10개월")),
      `total=${search.json?.total}, age=${searchItems[0]?.ageMonths}`,
    );
    const tagSearch = await req(`/api/search?tags=${encodeURIComponent("백일")}`);
    check("태그 모아보기 검색", tagSearch.status === 200 && tagSearch.json?.total >= 1, `total=${tagSearch.json?.total}`);
    const combo = await req(`/api/search?childId=${jiwoo.id}&ageMonths=10&kind=IMAGE`);
    check("아이+개월+종류 조합", combo.status === 200 && combo.json?.total >= 1, `total=${combo.json?.total}`);

    // ─────────────────────────────────────────────── 시나리오 6: 조부모 간편 모드
    console.log("\n▶ 시나리오 6 · 조부모 간편 모드");
    const grandma = await login("grandma@demo.family");
    const grandmaCookie = grandma.cookie;
    const simpleHome = await req("/simple", { useCookie: grandmaCookie });
    check("조부모 간편 모드 홈", simpleHome.status === 200 && simpleHome.text.includes("좋아요") && simpleHome.text.includes("댓글"), `status=${simpleHome.status}`);
    check("간편 모드 홈에 결제 메뉴 없음", !simpleHome.text.includes("/purchase") && !simpleHome.text.includes("광고 제거 상품"));
    const simpleSettings = await req("/simple/settings", { useCookie: grandmaCookie });
    check("간편 모드 설정에도 결제 메뉴 없음", simpleSettings.status === 200 && !simpleSettings.text.includes("/purchase"));

    const appAsGrandma = await req("/app", { useCookie: grandmaCookie, redirect: "manual" });
    check("조부모 계정은 부모 화면 접근 시 간편 모드로 이동", appAsGrandma.status === 307 || appAsGrandma.status === 302, `status=${appAsGrandma.status}, location=${appAsGrandma.headers.get("location")}`);

    const familyMedia = await req(`/api/album?childId=${jiwoo.id}`, { useCookie: grandmaCookie });
    const targetMedia = (familyMedia.json?.items ?? []).find((m) => m.visibility === "FAMILY");
    const viewer = await req(`/simple/viewer/${targetMedia.id}`, { useCookie: grandmaCookie });
    check("사진 크게 보기(전체 화면 뷰어)", viewer.status === 200 && viewer.text.includes("좋아요") && viewer.text.includes("댓글"));

    const likeBefore = targetMedia.likeCount;
    const like = await req(`/api/media/${targetMedia.id}/like`, { method: "POST", useCookie: grandmaCookie });
    check("조부모 좋아요", like.status === 200 && like.json?.liked === true && like.json?.likeCount === likeBefore + 1, `${likeBefore} → ${like.json?.likeCount}`);
    const comment = await req(`/api/media/${targetMedia.id}/comments`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ body: "우리 강아지 ㅋㅋ 아니 우리 손주 최고!" }),
      useCookie: grandmaCookie,
    });
    check("조부모 댓글 등록", comment.status === 200 && comment.json?.comment?.author === "박순자", comment.json?.comment?.body);
    const comments = await req(`/api/media/${targetMedia.id}/comments`, { useCookie: grandmaCookie });
    check("댓글 조회", (comments.json?.comments ?? []).some((c) => c.id === comment.json?.comment?.id));

    const grandmaDelete = await req(`/api/media/${targetMedia.id}`, { method: "DELETE", useCookie: grandmaCookie });
    check("조부모는 삭제 불가(부모 전용)", grandmaDelete.status === 403, `status=${grandmaDelete.status}`);

    const settingsHtml = await req("/app/settings");
    check(
      "결제 메뉴는 부모 설정 화면에만 존재",
      settingsHtml.text.includes("광고 제거 상품 보기") && settingsHtml.text.includes("결제 상태 재확인"),
    );
    const homeHtml = await req("/app");
    check("홈 화면에는 결제 링크 없음", !homeHtml.text.includes("/app/settings/purchase") && !homeHtml.text.includes("광고 제거 상품 보기"));

    const dashboardAsMom = await login("mom@demo.family");
    const momStatus = await req("/api/billing/status", { useCookie: dashboardAsMom.cookie });
    check("가족 전체 상품이 다른 부모 계정에도 적용", momStatus.json?.entitlement?.adFree === true, momStatus.json?.entitlement?.explanation);
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    if (!server.killed) server.kill("SIGKILL");
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n스모크 결과: ${passed}/${results.length} 통과`);
  if (passed !== results.length) {
    console.log("실패 항목:");
    for (const r of results.filter((x) => !x.passed)) console.log(` - ${r.name} (${r.detail})`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("스모크 실행 오류:", error);
  process.exitCode = 1;
});
