import { MarketPage } from "@/components/market-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "소스코드 마켓" };

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <MarketPage
      type="SOURCE"
      title="소스코드 마켓"
      description="전체 또는 일부 모듈, 수정·상업적 이용·재배포 범위를 확인하고 구매"
      searchParams={await searchParams}
    />
  );
}
