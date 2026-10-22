'use client';

import { AppShell, BrandMark } from '@/components/shell';
import { Spinner } from '@/components/ui';
import { SessionProvider } from '@/lib/session';

function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper">
      <div className="flex flex-col items-center gap-4">
        <BrandMark tone="paper" />
        <Spinner />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<Loading />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
