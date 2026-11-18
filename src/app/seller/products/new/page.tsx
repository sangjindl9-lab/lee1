import { requireActor } from "@/lib/session";
import { CATEGORIES } from "@/server/services/catalog";
import { Notice } from "@/components/ui";
import { createProductAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "상품 등록" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor("/seller/products/new");

  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.5rem] font-black text-[var(--color-navy)]">상품 등록</h1>
      <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
        {actor.sellerProfileId
          ? "등록 후 실제 납품 파일을 올리고 심사를 요청하면 판매가 시작됩니다."
          : "판매자 등록 후 상품을 올릴 수 있습니다."}
      </p>

      <form action={createProductAction} className="card mt-6 space-y-4 p-6">
        {sp.error && <Notice tone="danger">{sp.error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">거래 유형 *</span>
            <select name="type" className="input">
              <option value="SOLUTION">완성형 사용권 (PC·웹·모바일)</option>
              <option value="SOURCE">소스코드 구매</option>
            </select>
          </label>
          <label className="block">
            <span className="label">분야 *</span>
            <select name="category" className="input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">상품명 *</span>
          <input name="title" required className="input" />
        </label>
        <label className="block">
          <span className="label">요약 *</span>
          <input name="summary" required className="input" />
        </label>
        <label className="block">
          <span className="label">해결하는 업무 문제 *</span>
          <textarea name="problem" required className="input h-24" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">주요 기능 (줄바꿈으로 구분)</span>
            <textarea name="features" className="input h-24" />
          </label>
          <div className="space-y-3">
            <label className="block">
              <span className="label">포함 범위</span>
              <textarea name="includes" className="input h-10" />
            </label>
            <label className="block">
              <span className="label">제외 범위</span>
              <textarea name="excludes" className="input h-10" />
            </label>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">사용권 종류</span>
            <select name="licenseType" className="input">
              <option value="PERPETUAL">영구</option>
              <option value="PERIOD">기간제</option>
            </select>
          </label>
          <label className="block">
            <span className="label">기간(개월)</span>
            <input name="licenseMonths" type="number" min={1} defaultValue={12} className="input" />
          </label>
          <label className="block">
            <span className="label">사용자 수(선택)</span>
            <input name="seats" type="number" min={1} className="input" />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-[0.8125rem]">
          {["PC", "WEB", "MOBILE"].map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="checkbox" name="platforms" value={p} defaultChecked={p === "WEB"} />
              {p}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="sourceIncluded" value="on" /> 소스코드 포함
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="installSupport" value="on" /> 설치 지원
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="customization" value="on" /> 커스터마이징 가능
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">제3자 라이선스·외부 비용</span>
            <input name="thirdPartyDeps" className="input" placeholder="예: PostgreSQL(무료), 결제 API(별도 계약)" />
          </label>
          <label className="block">
            <span className="label">고지할 추가 비용</span>
            <input name="externalCostNote" className="input" placeholder="예: 서버 호스팅 월 5만원 별도" />
          </label>
          <label className="block">
            <span className="label">검수 기간(일) *</span>
            <input name="inspectionDays" type="number" min={1} defaultValue={7} className="input" />
          </label>
          <label className="block">
            <span className="label">가격(원) *</span>
            <input name="priceKrw" type="number" min={1} required className="input" />
          </label>
          <label className="block">
            <span className="label">납품 방식</span>
            <input name="deliveryNote" className="input" placeholder="결제 확인 후 즉시 다운로드" />
          </label>
          <label className="block">
            <span className="label">환불·분쟁 절차</span>
            <input name="refundPolicy" className="input" placeholder="다운로드 시작 시 청약철회 제한" />
          </label>
        </div>

        <button className="btn btn-primary" type="submit">
          상품 초안 저장
        </button>
        <p className="text-[0.6875rem] text-[#8c98aa]">
          판매 전 실제 납품물을 등록해야 심사를 요청할 수 있습니다. 빈 파일·개인키·개인정보가 포함된 파일은
          등록이 차단됩니다.
        </p>
      </form>
    </div>
  );
}
