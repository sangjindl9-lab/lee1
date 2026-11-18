import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { Badge, Notice, SectionHeading } from "@/components/ui";
import { becomeSellerAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "판매자 센터" };

export default async function SellerCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const actor = await requireActor("/dashboard/seller");
  const profile = actor.sellerProfileId
    ? await prisma.sellerProfile.findUnique({ where: { id: actor.sellerProfileId } })
    : null;

  return (
    <div>
      <SectionHeading
        title="판매자 센터"
        description="사업자·개인 구분에 따라 세금 처리와 정산 방식이 달라집니다."
        action={
          profile ? (
            <div className="flex gap-2">
              <Link href="/seller/ip/new" className="btn btn-outline btn-sm">
                지식재산권 등록
              </Link>
              <Link href="/seller/products/new" className="btn btn-primary btn-sm">
                상품 등록
              </Link>
            </div>
          ) : undefined
        }
      />

      {(sp.error || sp.ok) && (
        <div className="mb-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      {profile && (
        <div className="card mb-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[0.9375rem] font-bold text-[var(--color-navy)]">{profile.displayName}</div>
              <div className="text-[0.75rem] text-[#5a6a80]">
                {profile.sellerType === "BUSINESS" ? "사업자" : "개인"} · {profile.bizRegNo ?? "사업자번호 미등록"} ·
                정산계좌 {profile.accountMasked ?? "미등록"}
              </div>
            </div>
            <Badge tone={profile.status === "ACTIVE" ? "green" : "amber"}>
              {profile.status === "ACTIVE" ? "판매 승인" : profile.status === "PENDING" ? "심사 대기" : profile.status}
            </Badge>
          </div>
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
            계좌 변경 시 재인증과 알림이 발송됩니다. 개인 판매자는 정산 시 3.3% 원천징수, 사업자는 세금계산서 발행으로
            처리됩니다.
          </p>
        </div>
      )}

      <form action={becomeSellerAction} className="card space-y-3 p-5">
        <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">
          {profile ? "판매자 정보 수정" : "판매자 등록"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">정산 유형</span>
            <select name="sellerType" defaultValue={profile?.sellerType ?? "INDIVIDUAL"} className="input">
              <option value="INDIVIDUAL">개인 프리랜서 (3.3% 원천징수)</option>
              <option value="BUSINESS">사업자 (세금계산서 발행)</option>
            </select>
          </label>
          <label className="block">
            <span className="label">표시 이름</span>
            <input name="displayName" required defaultValue={profile?.displayName} className="input" />
          </label>
          <label className="block">
            <span className="label">상호(사업자)</span>
            <input name="bizName" defaultValue={profile?.bizName ?? ""} className="input" />
          </label>
          <label className="block">
            <span className="label">사업자등록번호</span>
            <input name="bizRegNo" defaultValue={profile?.bizRegNo ?? ""} className="input" placeholder="000-00-00000" />
          </label>
          <label className="block">
            <span className="label">세금계산서 이메일</span>
            <input name="taxEmail" type="email" defaultValue={profile?.taxEmail ?? ""} className="input" />
          </label>
          <label className="block">
            <span className="label">은행</span>
            <input name="bankName" defaultValue={profile?.bankName ?? ""} className="input" />
          </label>
          <label className="block">
            <span className="label">계좌번호 (암호화 저장)</span>
            <input name="accountNo" className="input" placeholder={profile?.accountMasked ?? "변경 시에만 입력"} />
          </label>
          <label className="block">
            <span className="label">예금주</span>
            <input name="accountHolder" defaultValue={profile?.accountHolder ?? ""} className="input" />
          </label>
        </div>
        <button className="btn btn-primary" type="submit">
          {profile ? "정보 저장" : "판매자 등록 신청"}
        </button>
        <p className="text-[0.6875rem] text-[#8c98aa]">
          등록 후 운영자 심사를 거쳐 판매가 활성화됩니다. 허위 정보·권리 침해 자료는 판매 제한 사유가 됩니다.
        </p>
      </form>
    </div>
  );
}
