import Link from "next/link";
import { getRetentionNotice } from "@/lib/retention";
import { kstDateKey } from "@/lib/date";

/** 구독이 끝나 무료 용량을 넘은 가족에게 보관 기한을 알린다 (모든 부모 화면 맨 위) */
export default async function RetentionBanner({ familyId }: { familyId: string | null }) {
  if (!familyId) return null;
  const n = await getRetentionNotice(familyId).catch(() => null);
  if (!n) return null;
  const date = kstDateKey(n.until);
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-amber-900">
        <span className="font-black">
          ⚠️ 구독이 끝나 무료 용량(1GB)을 {n.overLabel} 넘었어요. {date}까지({n.daysLeft}일 남음)는 모두 그대로 보관합니다.
        </span>
        <span>
          그때까지 재구독하거나 1GB 이하로 정리하지 않으면, 넘는 만큼만 휴지통 → 최근에 올린 사진·동영상 순서로 영구 삭제됩니다. 지우기 전에 앨범의
          &lsquo;ZIP 내려받기&rsquo;로 보관해 두세요.
        </span>
        <Link href="/app/plans" className="ml-auto rounded-full bg-amber-500 px-3 py-1 font-bold text-white">
          요금제 보기
        </Link>
      </div>
    </div>
  );
}
