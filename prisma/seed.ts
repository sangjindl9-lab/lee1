/**
 * 시드 데이터 — 첫째/둘째 아이, 부모·조부모·이모 데모 계정, 앨범·태그·육아기록.
 *
 * 실행: npm run db:seed
 * 로그인 비밀번호는 모든 데모 계정 공통 "demo1234".
 */
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import prisma from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { createMedia } from "../src/lib/media";
import { addMonthsKst, kstDateKey } from "../src/lib/date";

const DEMO_PASSWORD = "demo1234";

function svgPhoto(title: string, subtitle: string, hueA: number, hueB: number, emoji = "👶") {
  const w = 1600;
  const h = 1200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hueA},85%,88%)"/>
        <stop offset="100%" stop-color="hsl(${hueB},75%,72%)"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <circle cx="${w * 0.5}" cy="${h * 0.42}" r="210" fill="#ffffff" opacity="0.45"/>
    <text x="50%" y="46%" font-size="230" text-anchor="middle" font-family="sans-serif">${emoji}</text>
    <text x="50%" y="70%" font-size="86" text-anchor="middle" font-family="sans-serif" font-weight="700" fill="#1f2937">${title}</text>
    <text x="50%" y="78%" font-size="48" text-anchor="middle" font-family="sans-serif" fill="#374151" opacity="0.85">${subtitle}</text>
  </svg>`;
}

async function makePhoto(title: string, subtitle: string, hueA: number, hueB: number, emoji = "👶") {
  return sharp(Buffer.from(svgPhoto(title, subtitle, hueA, hueB, emoji)))
    .jpeg({ quality: 84 })
    .toBuffer();
}

function makeVideoStub(): Buffer {
  // 서버에 ffmpeg 이 없어 실제 재생 가능한 영상 대신 자리표시자 바이트를 저장한다.
  // 원본 화질/용량 보관 흐름(업로드·다운로드·ZIP)은 동일하게 검증된다.
  const head = Buffer.from("000000206674797069736F6D0000020069736F6D69736F32", "hex");
  return Buffer.concat([head, randomBytes(240 * 1024)]);
}

async function reset() {
  await prisma.job.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.mediaTag.deleteMany();
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.uploadItem.deleteMany();
  await prisma.uploadSession.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.careRecord.deleteMany();
  await prisma.inquiry.deleteMany();
  await prisma.adImpression.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.album.deleteMany();
  await prisma.child.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.family.deleteMany();
}

async function main() {
  await reset();

  const family = await prisma.family.create({
    data: { name: "이상진네 가족", inviteCode: "LEE-FAMILY-7K2M" },
  });

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const [dad, mom, grandma, grandpa, aunt] = await Promise.all([
    prisma.user.create({
      data: { email: "dad@demo.family", name: "이상진", role: "PARENT", relation: "아빠", passwordHash, familyId: family.id },
    }),
    prisma.user.create({
      data: { email: "mom@demo.family", name: "김하늘", role: "PARENT", relation: "엄마", passwordHash, familyId: family.id },
    }),
    prisma.user.create({
      data: { email: "grandma@demo.family", name: "박순자", role: "GRANDPARENT", relation: "할머니", passwordHash, familyId: family.id },
    }),
    prisma.user.create({
      data: { email: "grandpa@demo.family", name: "이만복", role: "GRANDPARENT", relation: "할아버지", passwordHash, familyId: family.id },
    }),
    prisma.user.create({
      data: { email: "aunt@demo.family", name: "이지은", role: "FAMILY", relation: "이모", passwordHash, familyId: family.id },
    }),
  ]);

  const seojun = await prisma.child.create({
    data: {
      familyId: family.id,
      name: "서준",
      nickname: "첫째",
      birthDate: new Date("2023-03-02T00:00:00+09:00"),
      avatarColor: "#60a5fa",
      sortOrder: 0,
    },
  });
  const jiwoo = await prisma.child.create({
    data: {
      familyId: family.id,
      name: "지우",
      nickname: "둘째",
      birthDate: new Date("2025-06-20T00:00:00+09:00"),
      avatarColor: "#f472b6",
      sortOrder: 1,
    },
  });

  const [seojunAlbum, jinwooAlbum, parentsOnlyAlbum] = await Promise.all([
    prisma.album.create({ data: { familyId: family.id, childId: seojun.id, name: "서준 앨범", visibility: "FAMILY" } }),
    prisma.album.create({ data: { familyId: family.id, childId: jiwoo.id, name: "지우 앨범", visibility: "FAMILY" } }),
    prisma.album.create({ data: { familyId: family.id, childId: seojun.id, name: "부모만 보는 서준", visibility: "PARENTS_ONLY" } }),
  ]);

  const tagNames = ["백일", "첫걸음", "어린이집", "가족여행", "생일", "수영"];
  const tags: Record<string, string> = {};
  for (const name of tagNames) {
    const tag = await prisma.tag.create({ data: { familyId: family.id, name } });
    tags[name] = tag.id;
  }

  type SeedMedia = {
    childId: string;
    albumId: string;
    title: string;
    subtitle: string;
    capturedAt: string;
    hueA: number;
    hueB: number;
    emoji?: string;
    kind?: "IMAGE" | "VIDEO";
    favorite?: boolean;
    visibility?: string;
    tags: string[];
  };

  const items: SeedMedia[] = [
    {
      childId: jiwoo.id, albumId: jinwooAlbum.id, title: "지우 태어난 날", subtitle: "2025년 6월 20일 · 3.2kg",
      capturedAt: "2025-06-20T10:12:00+09:00", hueA: 340, hueB: 20, emoji: "🍼", tags: ["생일"], favorite: true,
    },
    {
      childId: jiwoo.id, albumId: jinwooAlbum.id, title: "지우 백일", subtitle: "2025년 9월 28일 · 백일 사진",
      capturedAt: "2025-09-28T14:30:00+09:00", hueA: 320, hueB: 45, emoji: "🎀", tags: ["백일"],
    },
    {
      childId: jiwoo.id, albumId: jinwooAlbum.id, title: "지우 생후 10개월 · 첫 걸음마", subtitle: "2026년 4월 22일 · 소파를 잡고 걷기 시작",
      capturedAt: "2026-04-22T18:05:00+09:00", hueA: 280, hueB: 190, emoji: "🎬", kind: "VIDEO", tags: ["첫걸음"], favorite: true,
    },
    {
      childId: jiwoo.id, albumId: jinwooAlbum.id, title: "지우 생후 11개월 · 공원 산책", subtitle: "2026년 5월 17일 · 가족 나들이",
      capturedAt: "2026-05-17T11:20:00+09:00", hueA: 140, hueB: 90, emoji: "🌳", tags: ["가족여행"],
    },
    {
      childId: jiwoo.id, albumId: jinwooAlbum.id, title: "지우 첫 생일", subtitle: "2026년 6월 20일 · 돌잔치",
      capturedAt: "2026-06-20T12:40:00+09:00", hueA: 35, hueB: 330, emoji: "🎂", tags: ["생일"], favorite: true,
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 태어난 날", subtitle: "2023년 3월 2일 · 3.4kg",
      capturedAt: "2023-03-02T09:40:00+09:00", hueA: 210, hueB: 260, emoji: "👶", tags: [],
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 백일", subtitle: "2023년 6월 10일 · 백일 촬영",
      capturedAt: "2023-06-10T15:00:00+09:00", hueA: 200, hueB: 150, emoji: "🎀", tags: ["백일"],
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 첫걸음", subtitle: "2024년 3월 15일 · 거실에서 첫 발걸음",
      capturedAt: "2024-03-15T19:10:00+09:00", hueA: 160, hueB: 220, emoji: "👣", kind: "VIDEO", tags: ["첫걸음"],
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 생일", subtitle: "2024년 3월 2일 · 두 살 생일",
      capturedAt: "2024-03-02T18:00:00+09:00", hueA: 25, hueB: 350, emoji: "🎂", tags: ["생일"],
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 어린이집 첫날", subtitle: "2025년 9월 2일 · 만 2세반",
      capturedAt: "2025-09-02T08:50:00+09:00", hueA: 45, hueB: 160, emoji: "🎒", tags: ["어린이집"], favorite: true,
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "가족 여행 · 강릉", subtitle: "2025년 7월 26일 · 바다",
      capturedAt: "2025-07-26T13:15:00+09:00", hueA: 195, hueB: 230, emoji: "🌊", tags: ["가족여행"],
    },
    {
      childId: seojun.id, albumId: seojunAlbum.id, title: "서준 수영", subtitle: "2026년 7월 11일 · 수영 교실",
      capturedAt: "2026-07-11T16:30:00+09:00", hueA: 190, hueB: 200, emoji: "🏊", tags: ["수영"], kind: "VIDEO",
    },
    {
      childId: seojun.id, albumId: parentsOnlyAlbum.id, title: "서준 이발", subtitle: "2026년 2월 8일 · 부모만 보기",
      capturedAt: "2026-02-08T11:00:00+09:00", hueA: 260, hueB: 300, emoji: "✂️", tags: [], visibility: "PARENTS_ONLY",
    },
  ];

  const created: Array<{ id: string; tags: string[]; title: string }> = [];
  for (const item of items) {
    const kind = item.kind ?? "IMAGE";
    const buffer =
      kind === "VIDEO"
        ? makeVideoStub()
        : await makePhoto(item.title, item.subtitle, item.hueA, item.hueB, item.emoji);
    const { media } = await createMedia({
      familyId: family.id,
      childId: item.childId,
      albumId: item.albumId,
      ownerId: dad.id,
      fileName: `${item.title.replace(/\s/g, "_")}.${kind === "VIDEO" ? "mp4" : "jpg"}`,
      mimeType: kind === "VIDEO" ? "video/mp4" : "image/jpeg",
      buffer,
      capturedAt: new Date(item.capturedAt),
      visibility: item.visibility ?? "FAMILY",
      favorite: item.favorite,
    });
    for (const tagName of item.tags) {
      await prisma.mediaTag.create({ data: { mediaId: media.id, tagId: tags[tagName] } });
    }
    created.push({ id: media.id, tags: item.tags, title: item.title });
  }

  // 가족 반응: 할머니 좋아요·댓글, 엄마 댓글
  const first = created.find((c) => c.title.includes("10개월"));
  const birthday = created.find((c) => c.title.includes("지우 첫 생일"));
  if (first) {
    await prisma.like.create({ data: { mediaId: first.id, userId: grandma.id } });
    await prisma.like.create({ data: { mediaId: first.id, userId: grandpa.id } });
    await prisma.comment.create({
      data: { mediaId: first.id, userId: grandma.id, body: "우리 지우가 벌써 걸음마를! 할머니가 다 보고 있어요." },
    });
  }
  if (birthday) {
    await prisma.like.create({ data: { mediaId: birthday.id, userId: grandpa.id } });
  }

  // 육아 기록 — 자정을 넘긴 수면(어제 23:40 → 오늘 01:10 = 90분) 포함
  const now = new Date();
  const y = new Date(now.getTime() - 24 * 3600 * 1000);
  const yesterdayKey = kstDateKey(y);
  const todayKey = kstDateKey(now);
  const yesterdayStart = new Date(`${yesterdayKey}T23:40:00+09:00`);
  const todayEnd = new Date(`${todayKey}T01:10:00+09:00`);
  const overnightEnd = todayEnd.getTime() > yesterdayStart.getTime() ? todayEnd : new Date(yesterdayStart.getTime() + 90 * 60000);

  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: jiwoo.id, type: "SLEEP",
      startAt: yesterdayStart, endAt: overnightEnd,
      durationMinutes: Math.round((overnightEnd.getTime() - yesterdayStart.getTime()) / 60000),
      status: "DONE", note: "밤잠 (자정 넘김)", createdById: mom.id,
    },
  });
  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: jiwoo.id, type: "SLEEP",
      startAt: new Date(`${todayKey}T10:20:00+09:00`), endAt: new Date(`${todayKey}T11:50:00+09:00`),
      durationMinutes: 90, status: "DONE", note: "오전 낮잠", createdById: grandma.id,
    },
  });
  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: jiwoo.id, type: "SLEEP",
      startAt: new Date(now.getTime() - 45 * 60000), status: "ONGOING",
      note: "수면 중", createdById: mom.id,
    },
  });
  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: jiwoo.id, type: "FEEDING",
      startAt: new Date(`${todayKey}T08:30:00+09:00`), amountMl: 180, status: "DONE", createdById: mom.id,
    },
  });
  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: jiwoo.id, type: "FEEDING",
      startAt: new Date(`${todayKey}T13:10:00+09:00`), amountMl: 160, status: "DONE", createdById: grandma.id,
    },
  });
  await prisma.careRecord.create({
    data: {
      familyId: family.id, childId: seojun.id, type: "FEEDING",
      startAt: new Date(`${todayKey}T09:00:00+09:00`), amountMl: 240, status: "DONE", note: "우유", createdById: dad.id,
    },
  });

  const counts = {
    users: await prisma.user.count(),
    children: await prisma.child.count(),
    media: await prisma.mediaAsset.count(),
    tags: await prisma.tag.count(),
    care: await prisma.careRecord.count(),
  };
  console.log("시드 완료", counts);
  console.log(`데모 로그인: dad@demo.family / ${DEMO_PASSWORD}`);
  console.log(`둘째 지우 생후 개월 기준: 2025-06-20 출생, 2026-04-22 촬영 →`, addMonthsKst(jiwoo.birthDate, 10).toISOString());
  // 참조: 이모 계정 (미사용 경고 방지)
  void aunt;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
