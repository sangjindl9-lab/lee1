import { requireActor } from "@/lib/session";
import { Notice } from "@/components/ui";
import { createDevRequestAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "의뢰 등록" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  await requireActor("/requests/new");

  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.5rem] font-black text-[var(--color-navy)]">맞춤 개발 의뢰 등록</h1>
      <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
        요구사항이 구체적일수록 정확한 견적과 검수 기준을 받을 수 있습니다.
      </p>

      <form action={createDevRequestAction} className="card mt-6 space-y-4 p-6">
        {sp.error && <Notice tone="danger">{sp.error}</Notice>}
        <label className="block">
          <span className="label">의뢰 제목 *</span>
          <input name="title" required className="input" placeholder="예: 전기공사 현장 일보 자동화 앱" />
        </label>
        <label className="block">
          <span className="label">개발 목적 *</span>
          <textarea name="purpose" required className="input h-24" placeholder="해결하려는 업무 문제" />
        </label>
        <label className="block">
          <span className="label">기능 요구사항 *</span>
          <textarea name="features" required className="input h-32" placeholder="기능을 목록으로 적어 주세요" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">실행 환경 *</span>
            <input name="environment" required className="input" placeholder="웹/모바일, 서버, 연동 시스템" />
          </label>
          <label className="block">
            <span className="label">예산(원)</span>
            <input name="budgetKrw" className="input" inputMode="numeric" placeholder="예: 12000000" />
          </label>
          <label className="block">
            <span className="label">희망 납기</span>
            <input name="deadline" className="input" placeholder="2027-01-31" />
          </label>
          <label className="block">
            <span className="label">공개 범위</span>
            <select name="visibility" className="input">
              <option value="PUBLIC">공개 (견적 공개 모집)</option>
              <option value="PRIVATE">비공개 (선택 초대)</option>
            </select>
          </label>
          <label className="block">
            <span className="label">소스코드 제공 조건</span>
            <input name="sourceCondition" className="input" placeholder="전체 소스 인도 / 실행 파일만" />
          </label>
          <label className="block">
            <span className="label">권리 귀속</span>
            <input name="rights" className="input" placeholder="저작권 양도 / 이용허락" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">유지보수 조건</span>
            <input name="maintenance" className="input" placeholder="3개월 무상 하자보수 등" />
          </label>
        </div>
        <button className="btn btn-primary" type="submit">
          의뢰 등록
        </button>
      </form>
    </div>
  );
}
