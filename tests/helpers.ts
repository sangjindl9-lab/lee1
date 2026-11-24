import sharp from "sharp";
import prisma from "@/lib/db";
import { hashPassword } from "@/lib/password";

export async function resetDb() {
  await prisma.rtdnEvent.deleteMany();
  await prisma.purchaseIntent.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.job.deleteMany();
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

export const PASSWORD = "demo1234";

export async function makeFamily() {
  const family = await prisma.family.create({ data: { name: "테스트 가족", inviteCode: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } });
  const passwordHash = hashPassword(PASSWORD);
  const dad = await prisma.user.create({
    data: { email: `dad-${family.id}@test.local`, name: "아빠", role: "PARENT", relation: "아빠", passwordHash, familyId: family.id },
  });
  const mom = await prisma.user.create({
    data: { email: `mom-${family.id}@test.local`, name: "엄마", role: "PARENT", relation: "엄마", passwordHash, familyId: family.id },
  });
  const grandma = await prisma.user.create({
    data: { email: `grandma-${family.id}@test.local`, name: "할머니", role: "GRANDPARENT", relation: "할머니", passwordHash, familyId: family.id },
  });
  const first = await prisma.child.create({
    data: { familyId: family.id, name: "서준", nickname: "첫째", birthDate: new Date("2023-03-02T00:00:00+09:00"), sortOrder: 0 },
  });
  const second = await prisma.child.create({
    data: { familyId: family.id, name: "지우", nickname: "둘째", birthDate: new Date("2025-06-20T00:00:00+09:00"), sortOrder: 1 },
  });
  const firstAlbum = await prisma.album.create({ data: { familyId: family.id, childId: first.id, name: "서준 앨범" } });
  const secondAlbum = await prisma.album.create({ data: { familyId: family.id, childId: second.id, name: "지우 앨범" } });
  return { family, dad, mom, grandma, first, second, firstAlbum, secondAlbum };
}

let color = 0;
/** 서로 다른 내용의 작은 JPEG (해시가 모두 다르다) */
export async function makeImageBuffer(tag: string): Promise<Buffer> {
  color = (color + 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72">
    <rect width="96" height="72" fill="hsl(${color},70%,70%)"/>
    <text x="48" y="42" font-size="16" text-anchor="middle" fill="#111">${tag}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
}

export function makeVideoBuffer(seed = "v"): Buffer {
  return Buffer.concat([Buffer.from("000000206674797069736F6D", "hex"), Buffer.from(`${seed}-`.repeat(500))]);
}

export function photoFile(index: number) {
  return { fileName: `photo-${String(index).padStart(3, "0")}.jpg`, mimeType: "image/jpeg" };
}
