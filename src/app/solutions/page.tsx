import { MarketPage } from "@/components/market-page";

export const dynamic = "force-dynamic";

export const metadata = { title: "솔루션 마켓" };

export default async function SolutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <MarketPage
      type="SOLUTION"
      title="솔루션 마켓"
      description="PC 설치형·웹서비스·모바일 앱 사용권을 기간 또는 영구로 구매"
      searchParams={await searchParams}
    />
  );
}
