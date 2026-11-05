export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M16 2.5 28.5 9.7v12.6L16 29.5 3.5 22.3V9.7z" fill="var(--accent)" />
      <path d="M16 2.5v27M3.5 9.7 16 17l12.5-7.3" stroke="var(--accent-ink)" strokeWidth="1.8" fill="none" />
    </svg>
  );
}
export function Wordmark() {
  return (
    <div className="flex items-center gap-2 select-none">
      <Logo />
      <div className="leading-none">
        <div className="text-[13px] font-extrabold tracking-[0.12em]">EUM 3D STUDIO <span className="text-accent">PRO</span></div>
      </div>
    </div>
  );
}
