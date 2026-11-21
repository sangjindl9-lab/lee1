import { randomBytes } from "node:crypto";
import prisma from "./db";
import { hashPassword } from "./password";

export class SignupError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const RELATIONS_PARENT = ["엄마", "아빠"];

export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export type SignupInput = {
  email: string;
  password: string;
  name: string;
  relation: string;
  agreeTerms: boolean;
  /** 새 가족 만들기 */
  familyName?: string;
  childName?: string;
  childBirthDate?: string;
  /** 초대받은 가족에 합류 */
  inviteCode?: string;
};

export async function signup(input: SignupInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 20);
  const relation = input.relation.trim().slice(0, 10);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SignupError("BAD_EMAIL", "이메일 주소를 확인해 주세요.");
  if (input.password.length < 8) throw new SignupError("WEAK_PASSWORD", "비밀번호는 8자 이상으로 해 주세요.");
  if (!name) throw new SignupError("NO_NAME", "이름을 입력해 주세요.");
  if (!relation) throw new SignupError("NO_RELATION", "아이와의 관계를 골라 주세요.");
  if (!input.agreeTerms) throw new SignupError("TERMS", "이용약관과 개인정보처리방침에 동의해 주세요.");
  if (await prisma.user.findUnique({ where: { email } })) throw new SignupError("EMAIL_TAKEN", "이미 가입된 이메일입니다.", 409);
  const passwordHash = hashPassword(input.password);

  const code = (input.inviteCode ?? "").trim().toUpperCase();
  if (code) {
    const family = await prisma.family.findUnique({ where: { inviteCode: code } });
    if (!family) throw new SignupError("BAD_INVITE", "초대 코드를 찾을 수 없습니다. 가족에게 코드를 다시 확인해 주세요.", 404);
    const members = await prisma.user.count({ where: { familyId: family.id } });
    if (members >= 20) throw new SignupError("FAMILY_FULL", "한 가족은 20명까지 함께할 수 있습니다.");
    const isParent = RELATIONS_PARENT.includes(relation);
    const role = isParent ? "PARENT" : ["할머니", "할아버지", "외할머니", "외할아버지"].includes(relation) ? "GRANDPARENT" : "FAMILY";
    return prisma.user.create({ data: { email, passwordHash, name, relation, role, familyId: family.id } });
  }

  const childName = (input.childName ?? "").trim().slice(0, 20);
  const birth = input.childBirthDate ? new Date(`${input.childBirthDate}T00:00:00+09:00`) : null;
  if (!childName || !birth || Number.isNaN(birth.getTime())) {
    throw new SignupError("NO_CHILD", "첫 아이의 이름과 생일을 입력해 주세요. (나중에 더 추가할 수 있어요)");
  }
  const familyName = (input.familyName ?? "").trim().slice(0, 30) || `${name}네 가족`;
  return prisma.$transaction(async (tx) => {
    let inviteCode = newInviteCode();
    while (await tx.family.findUnique({ where: { inviteCode } })) inviteCode = newInviteCode();
    const family = await tx.family.create({ data: { name: familyName, inviteCode } });
    const user = await tx.user.create({ data: { email, passwordHash, name, relation, role: "PARENT", familyId: family.id } });
    const child = await tx.child.create({
      data: { familyId: family.id, name: childName, nickname: "첫째", birthDate: birth, avatarColor: "#60a5fa", sortOrder: 0 },
    });
    await tx.album.create({ data: { familyId: family.id, childId: child.id, name: `${childName} 앨범`, visibility: "FAMILY" } });
    return user;
  });
}
