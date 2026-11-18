import { requireActor } from "@/lib/session";
import { Notice } from "@/components/ui";
import { createIpAssetAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "지식재산권 등록" };

export default async function NewIpAssetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor("/seller/ip/new");

  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.5rem] font-black text-[var(--color-navy)]">지식재산권 자산 등록</h1>
      <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
        {actor.sellerProfileId ? "공개 소개와 비공개 자료실을 분리해 등록합니다." : "판매자 등록 후 자산을 등록할 수 있습니다."}
      </p>

      <form action={createIpAssetAction} className="card mt-6 space-y-4 p-6">
        {sp.error && <Notice tone="danger">{sp.error}</Notice>}
        <label className="block">
          <span className="label">자산명 *</span>
          <input name="title" required className="input" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">권리 종류 *</span>
            <select name="rightsType" className="input">
              <option>저작재산권 양도</option>
              <option>독점 이용허락</option>
              <option>비독점 이용허락</option>
              <option>상표·도메인</option>
              <option>사업 자산 양도</option>
              <option>기타 상담</option>
            </select>
          </label>
          <label className="block">
            <span className="label">거래 형태 *</span>
            <select name="transferMode" className="input">
              <option value="ASSIGNMENT">양도</option>
              <option value="EXCLUSIVE_LICENSE">독점 이용허락</option>
              <option value="NON_EXCLUSIVE_LICENSE">비독점 이용허락</option>
              <option value="CONSULTATION">상담</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label">대상 *</span>
          <textarea name="target" required className="input h-16" placeholder="양도·허락 대상 (소스, 상표, 도메인, 계약 등)" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">권리자 *</span>
            <input name="owner" required className="input" />
          </label>
          <label className="block">
            <span className="label">판매 권한 근거</span>
            <input name="authorityBasis" className="input" placeholder="자체 개발, 위임장 등" />
          </label>
          <label className="block">
            <span className="label">공동 권리자</span>
            <input name="coOwners" className="input" placeholder="없으면 비워 두세요" />
          </label>
          <label className="block">
            <span className="label">가격(원) *</span>
            <input name="priceKrw" type="number" min={1} required className="input" />
          </label>
          <label className="block">
            <span className="label">기간</span>
            <input name="period" className="input" placeholder="영구 / 3년 등" />
          </label>
          <label className="block">
            <span className="label">지역</span>
            <input name="territory" className="input" placeholder="대한민국" />
          </label>
          <label className="block">
            <span className="label">사용 분야</span>
            <input name="field" className="input" />
          </label>
          <label className="block">
            <span className="label">기존 이용허락</span>
            <input name="existingLicenses" className="input" placeholder="기존 계약 승계 조건" />
          </label>
          <label className="block">
            <span className="label">제3자 구성요소</span>
            <input name="thirdParty" className="input" placeholder="오픈소스·외부 라이선스" />
          </label>
        </div>
        <label className="block">
          <span className="label">포함 자산 *</span>
          <textarea name="includedAssets" required className="input h-20" placeholder="소스 저장소, 디자인 원본, 도메인, 상표, 계약 등" />
        </label>
        <label className="block">
          <span className="label">제외 자산</span>
          <textarea name="excludedAssets" className="input h-16" />
        </label>
        <label className="block">
          <span className="label">공개 소개 *</span>
          <textarea name="publicIntro" required className="input h-24" />
        </label>
        <label className="block">
          <span className="label">비공개 안내 (NDA 후 열람)</span>
          <input name="confidentialNote" className="input" placeholder="권리 증빙·계약서는 NDA 후 열람" />
        </label>
        <button className="btn btn-primary" type="submit">
          자산 등록
        </button>
        <p className="text-[0.6875rem] text-[#8c98aa]">
          등록 후 운영자 심사를 거쳐 공개됩니다. 비공개 자료는 NDA 동의 후 승인된 사용자만 열람할 수 있습니다.
        </p>
      </form>
    </div>
  );
}
