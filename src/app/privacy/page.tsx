import type { Metadata } from "next";

export const metadata: Metadata = { title: "개인정보처리방침 · 가족앨범" };

const CONTACT = "pm999@naver.com";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-7 text-slate-700">
      <h1 className="mb-1 text-2xl font-black text-slate-900">가족앨범 개인정보처리방침</h1>
      <p className="mb-8 text-xs text-slate-500">시행일: 2026년 11월 21일 · 운영: 이음소프트웨어</p>

      <h2 className="mt-6 font-bold text-slate-900">1. 수집하는 정보</h2>
      <ul className="list-disc pl-5">
        <li>계정 정보: 이메일, 이름, 가족 내 관계(엄마·아빠·할머니 등), 비밀번호(암호화 저장)</li>
        <li>사용자가 올린 사진·동영상 원본과 촬영일 등 파일 정보</li>
        <li>아이 정보: 이름, 생년월일 (앨범 분류와 생후 개월 계산용)</li>
        <li>육아 기록: 수유·수면 시각 등 사용자가 입력한 기록</li>
        <li>좋아요·댓글·태그, 문의 내용</li>
        <li>로그인 유지를 위한 세션 쿠키</li>
      </ul>

      <h2 className="mt-6 font-bold text-slate-900">2. 이용 목적</h2>
      <p>가족 간 사진·동영상 보관과 공유, 육아 기록 제공, 로그인 유지, 문의 응대에만 사용합니다. 광고 타기팅이나 제3자 판매에 사용하지 않습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">3. 공유 범위</h2>
      <p>올린 사진과 기록은 같은 가족으로 초대된 구성원에게만 공개 범위 설정에 따라 보입니다. 법령에 따른 요청이 있는 경우를 제외하고 외부에 제공하지 않습니다.</p>
      <p className="mt-2 font-semibold text-slate-800">처리 위탁 및 국외 이전</p>
      <ul className="list-disc pl-5">
        <li>이전받는 자: Railway Corporation (미국) — 서버·데이터베이스·파일 저장소 운영</li>
        <li>이전 국가·장소: 싱가포르 데이터센터 (일부 서버 운영은 미국)</li>
        <li>이전 항목: 계정 정보(이메일·이름·관계), 아이 이름·생일, 사진·동영상과 육아 기록</li>
        <li>이전 시기·방법: 서비스 이용 시 암호화된 네트워크(HTTPS)로 전송</li>
        <li>보유 기간: 회원 탈퇴 또는 위탁 계약 종료 시까지</li>
        <li>Google LLC (미국) — 유료 구독 결제 처리(Google Play). 결제 카드 정보는 가족앨범이 받지 않습니다.</li>
      </ul>
      <p className="mt-1">국외 이전을 원하지 않으시면 가입하지 않거나 회원 탈퇴할 수 있으며, 이 경우 서비스를 이용할 수 없습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">4. 보관 및 파기</h2>
      <p>정보는 계정이 유지되는 동안 보관합니다. 휴지통으로 옮긴 사진은 복구할 수 있으며, 앱의 설정 → 회원 탈퇴로 직접 계정을 삭제할 수 있습니다. 가족의 마지막 부모가 탈퇴하면 그 가족의 사진·동영상·기록 전체가 지체 없이(보통 하루 안에) 삭제됩니다. 휴지통의 사진은 30일 뒤 자동으로 완전히 삭제됩니다. 유료 구독이 끝나 무료 용량(3GB)을 넘은 경우, 넘는 분량은 구독이 끝난 날부터 30일간 보관한 뒤 최근에 올린 것부터 삭제합니다(이용약관 5조). 결제 기록은 전자상거래법에 따라 5년간 보관할 수 있습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">5. 전송 보안</h2>
      <p>앱과 서버 사이의 모든 통신은 HTTPS로 암호화되며, 비밀번호는 복호화할 수 없는 방식으로 저장합니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">6. 이용자 권리 · 계정 삭제 요청</h2>
      <p>
        내 정보의 열람·수정·삭제와 계정 삭제는 앱의 설정 → 문의 또는 아래 이메일로 요청할 수 있습니다. 요청 확인 후 7일 이내에 처리합니다.
      </p>

      <h2 className="mt-6 font-bold text-slate-900">7. 아동의 개인정보</h2>
      <p>아이 정보와 사진은 보호자(부모 계정)가 직접 등록하며, 서비스는 아동에게 직접 정보를 받지 않습니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">8. 문의처</h2>
      <p>
        개인정보 보호 책임자: 이음소프트웨어 · 이메일 <a className="font-semibold underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </main>
  );
}
