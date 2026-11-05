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
        <div className="text-[13px] font-extrabold tracking-[0.12em]">EUM 3D SHOWROOM <span className="text-accent">PRO</span></div>
      </div>
    </div>
  );
}

/** 고객사 대표 색상 → CSS 변수 (글자색은 밝기에 따라 검정/흰색) */
export function brandStyle(color?: string): React.CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const n = parseInt(color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const ink = lum > 0.6 ? '#111111' : '#ffffff';
  // Tailwind 색상 변수(--color-accent)는 :root 에서 계산되므로 같이 덮어쓴다
  return { ['--accent' as any]: color, ['--accent-ink' as any]: ink, ['--color-accent' as any]: color, ['--color-accent-ink' as any]: ink };
}

/** 고객사 로고(없으면 기본 마크) + 이름 */
export function BrandMark({ brand, name, size = 28, compact = false }: { brand?: any; name: string; size?: number; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="brand-mark">
      {brand?.logo ? <img src={brand.logo} alt={name} style={{ height: size, maxWidth: size * 4 }} className="shrink-0 object-contain" /> : <Logo size={size * 0.8} />}
      <div className={`min-w-0 leading-tight ${compact ? 'hidden sm:block' : ''}`}>
        <div className="truncate text-sm font-semibold">{brand?.programName || name}</div>
        {brand?.programName && brand.programName !== name && <div className="truncate text-[11px] text-mute">{name}</div>}
      </div>
    </div>
  );
}
