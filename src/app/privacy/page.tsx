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
      <p>올린 사진과 기록은 같은 가족으로 초대된 구성원에게만 공개 범위 설정에 따라 보입니다. 법령에 따른 요청이 있는 경우를 제외하고 외부에 제공하지 않습니다. 서비스 운영을 위해 클라우드 서버(Railway)에 저장됩니다.</p>

      <h2 className="mt-6 font-bold text-slate-900">4. 보관 및 파기</h2>
      <p>정보는 계정이 유지되는 동안 보관합니다. 휴지통으로 옮긴 사진은 복구할 수 있으며, 계정 삭제를 요청하시면 계정과 올린 파일, 기록을 지체 없이 삭제합니다.</p>

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
