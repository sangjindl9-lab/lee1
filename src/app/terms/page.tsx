import Link from "next/link";

export const metadata = { title: "이용약관 · 가족앨범" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-sm leading-relaxed text-slate-700">
      <h1 className="text-2xl font-black text-slate-900">가족앨범 이용약관</h1>
      <p className="mt-1 text-xs text-slate-400">시행일: 2026년 11월 21일</p>

      <h2 className="mt-6 font-bold text-slate-900">1. 서비스</h2>
      <p>가족앨범(이하 &lsquo;서비스&rsquo;)은 이음소프트웨어가 제공하는, 아이 사진·동영상과 육아 기록을 초대한 가족끼리 보관·공유하는 서비스입니다. 만 14세 이상만 가입할 수 있습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">2. 요금제</h2>
      <ul className="list-disc pl-5">
        <li>무료: 가족당 3GB. 사진은 긴 변 2048px 고화질 압축본, 동영상은 1분·720p 로 보관합니다.</li>
        <li>패밀리 50GB: 월 2,900원 또는 연 29,000원 — 원본 그대로 보관, 광고 없음, 원본 ZIP 내려받기.</li>
        <li>패밀리 200GB: 월 6,900원 또는 연 75,000원.</li>
        <li>패밀리 1TB: 월 29,900원.</li>
      </ul>
      <p className="mt-1">가격은 부가가치세를 포함합니다. 요금제 저장 공간은 같은 가족 구성원 모두가 함께 씁니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">3. 결제 · 자동 갱신 · 해지</h2>
      <ul className="list-disc pl-5">
        <li>유료 요금제는 Google Play 정기 결제로 결제되며, 해지하지 않으면 매 결제 주기마다 자동으로 갱신·청구됩니다.</li>
        <li>해지는 Google Play 앱 → 결제 및 정기 결제에서 언제든지 할 수 있고, 해지해도 이미 결제한 기간이 끝날 때까지 이용할 수 있습니다.</li>
        <li>무료 체험이 있는 요금제는 체험 기간이 끝나기 전에 해지하지 않으면 유료로 전환됩니다.</li>
        <li>요금제를 바꾸면 남은 기간은 Google Play 정책에 따라 일할 계산됩니다.</li>
      </ul>

      <h2 className="mt-6 font-bold text-slate-900">4. 청약철회 · 환불</h2>
      <p>결제 후 7일 이내에 유료 기능(원본 보관·추가 용량)을 사용하지 않은 경우 전액 환불을 요청할 수 있습니다. 환불은 Google Play 환불 절차 또는 아래 문의처로 요청할 수 있으며, Google Play 정책과 관계 법령(전자상거래법 등)에 따릅니다. 서비스 장애로 이용하지 못한 기간은 그만큼 보상합니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">5. 요금제를 낮추거나 해지한 경우</h2>
      <p>이미 올린 사진·동영상은 지우지 않습니다. 사용량이 새 요금제 용량을 넘으면 새로 올리기만 멈추며, 보기·내려받기·삭제는 계속 할 수 있습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">6. 이용자의 의무</h2>
      <p>다른 사람의 권리를 침해하거나 법령에 어긋나는 사진·동영상을 올려서는 안 됩니다. 이를 어기면 이용을 제한할 수 있습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">7. 서비스 변경 · 종료</h2>
      <p>서비스를 종료할 때는 최소 30일 전에 알리고, 그 기간 동안 모든 사진을 내려받을 수 있게 합니다. 남은 유료 기간은 환불합니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">8. 책임 제한</h2>
      <p>서비스는 저장소에 사진을 안전하게 보관하기 위해 노력하지만, 소중한 사진은 기기나 다른 곳에도 따로 보관하실 것을 권합니다. 천재지변 등 불가항력으로 인한 손해에는 책임을 지지 않습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">9. 문의</h2>
      <p>이음소프트웨어 · pm999@naver.com</p>

      <p className="mt-8">
        <Link href="/privacy" className="font-bold text-rose-600 underline">개인정보처리방침</Link> ·{" "}
        <Link href="/login" className="underline">돌아가기</Link>
      </p>
    </main>
  );
}
