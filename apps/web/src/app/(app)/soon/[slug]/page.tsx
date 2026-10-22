'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, Circle } from 'lucide-react';
import { Button, PageHeader } from '@/components/ui';
import { ALL_ITEMS, findSoon, isLiveItem, STAGE_TITLE } from '@/lib/nav';

const STAGES = [
  { n: 1, title: '기반', body: '로그인·권한·회사·현장·거래처·대시보드·감사로그' },
  { n: 2, title: '회계·발주 핵심', body: '자재·발주·검수·전자결재 (완료) → 지급결의·복식부기·현장원가 (진행 중)' },
  { n: 3, title: '세금계산서·문서 스캔', body: '팝빌·바로빌 발행, 홈택스 수집, AI 문서 인식, 대사' },
  { n: 4, title: '공사관리 고도화', body: '변경계약·기성·수금·하도급·노무비·준공정산' },
  { n: 5, title: '금융·외부연동', body: '계좌·카드 대사, 나라장터, 외부 REST API, 백업' },
];

/** 아직 구현되지 않은 메뉴 — 무엇이 언제 들어오는지 안내 (가짜 화면을 만들지 않는다) */
export default function SoonPage() {
  const { slug } = useParams<{ slug: string }>();
  const item = findSoon(slug);
  if (!item) return <PageHeader title="준비 중인 메뉴" />;
  const siblings = ALL_ITEMS.filter((i) => i.stage === item.stage && i.href !== item.href && !isLiveItem(i));
  return (
    <>
      <PageHeader title={item.label} description={`${item.group} · ${STAGE_TITLE[item.stage]}`} />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[6px] border border-line bg-surface p-5">
          <p className="text-section font-semibold">{item.stage}단계에서 제공됩니다</p>
          <p className="mt-2 text-ink-2">{item.hint}</p>
          <p className="mt-4 text-muted">이 메뉴는 아직 실제 데이터와 연결되지 않았습니다. 화면만 먼저 보여 드리지 않고, 저장·계산·권한까지 동작하는 상태가 되면 열립니다.</p>
          {siblings.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-meta text-muted">같은 단계에 함께 들어오는 기능</p>
              <ul className="flex flex-wrap gap-1.5">
                {siblings.map((s) => <li key={s.href}><Link href={s.href} className="inline-block rounded-[4px] border border-line px-2 py-1 text-meta text-ink-2 hover:border-line-strong">{s.label}</Link></li>)}
              </ul>
            </>
          )}
          <div className="mt-6"><Link href="/dashboard"><Button>대시보드로</Button></Link></div>
        </section>
        <aside className="rounded-[6px] border border-line bg-surface p-5">
          <p className="mb-3 text-section font-semibold">개발 단계</p>
          <ol className="relative space-y-4 border-l border-line pl-5">
            {STAGES.map((s) => (
              <li key={s.n} className="relative">
                <span className="absolute top-0.5 -left-[27px] grid size-[14px] place-items-center rounded-full bg-surface">
                  {s.n === 1 ? <Check className="size-3.5 text-ok" strokeWidth={3} /> : <Circle className={s.n === item.stage ? 'size-3 fill-steel text-steel' : 'size-3 text-line-strong'} />}
                </span>
                <p className={s.n === item.stage ? 'font-semibold' : s.n === 1 ? 'text-ink-2' : 'text-muted'}>{s.n}단계 · {s.title}{s.n === 1 && <span className="ml-1.5 text-meta font-normal text-ok">완료</span>}</p>
                <p className="mt-0.5 text-meta text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
