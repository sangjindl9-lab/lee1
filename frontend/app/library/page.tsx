"use client";
import { VideoTile } from "@/components/Projects";
import { Empty, Page } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function Library() {
  const { data } = useApi<any[]>("/projects?status=COMPLETED");
  return (
    <Page title="완성 영상 보관함" meta={data ? `${data.length}개` : undefined}>
      {!data ? <Empty>불러오는 중</Empty> : !data.length ? <Empty>완성된 영상이 여기에 모입니다</Empty> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-8">{data.map((p) => <VideoTile key={p.id} p={p} />)}</div>
      )}
    </Page>
  );
}
