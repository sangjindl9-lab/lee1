import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="text-center space-y-4 py-8">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
          이음전력 진단
        </h1>
        <p className="mx-auto max-w-2xl text-slate-600">
          가정·가게·사무실의 현재 전기 사용기기와 추가 예정기기, 계약전력, 분전반 정보를 바탕으로
          <strong className="text-teal-800"> 전력 부족 가능성</strong>,
          <strong className="text-teal-800"> 계약전력 증설 필요성</strong>,
          <strong className="text-teal-800"> 설비 개선 범위</strong>를 검토합니다.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link href="/quick" className="btn-primary">
            무료 간편 계산 시작
          </Link>
          <Link href="/places" className="btn-secondary">
            장소 등록·저장하기
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <h2 className="font-semibold text-teal-800 mb-2">계약전력</h2>
          <p className="text-sm text-slate-600">
            한전 또는 건물 관리주체와 계약·배정된 전력입니다. 아파트·호실은 한전 직접 신청과 절차가 다릅니다.
          </p>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold text-teal-800 mb-2">예상 사용전력</h2>
          <p className="text-sm text-slate-600">
            사용기기와 동시 사용 조건으로 계산한 전력입니다. 월간 kWh를 순간 kW로 오인하지 않습니다.
          </p>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold text-teal-800 mb-2">설비 수용능력</h2>
          <p className="text-sm text-slate-600">
            인입선·간선·분전반·차단기·분기회로가 감당할 수 있는 범위입니다. 차단기만 키우는 권고는 하지 않습니다.
          </p>
        </div>
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="text-lg font-semibold">결과 상태 안내</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li><span className="badge status-SUFFICIENT">입력 조건상 여유 있음</span></li>
          <li><span className="badge status-CONTRACT_INCREASE_REVIEW">계약전력 증설 검토</span></li>
          <li><span className="badge status-WIRING_BREAKER_REVIEW">배선·차단기·회로 개선 검토</span></li>
          <li><span className="badge status-BOTH_REVIEW">계약전력 및 설비 개선 동시 검토</span></li>
          <li><span className="badge status-INSUFFICIENT_INFO">정보 부족으로 판단 보류</span></li>
          <li><span className="badge status-EXPERT_REQUIRED">현장 전문가 확인 필요</span></li>
        </ul>
        <p className="text-xs text-slate-500 pt-2">
          “안전 인증”, “검사 합격” 등의 표현은 사용하지 않습니다. 사진만으로 누전·접지·단자 상태·법적 적합성을 확정하지 않습니다.
        </p>
      </section>

      <section className="text-center text-sm text-slate-500">
        <p>데모 계정: user@ieum.power / user1234 · admin@ieum.power / admin1234</p>
      </section>
    </div>
  );
}
