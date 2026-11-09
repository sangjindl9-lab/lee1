import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface Branding {
  productName: string;
  productNameKo: string;
  companyName: string;
  logoUrl: string;
}

const EMPTY: Branding = { productName: '', productNameKo: '', companyName: '', logoUrl: '' };

const BrandingContext = createContext<Branding>(EMPTY);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 제품명·회사명·로고는 코드에 넣지 않고 /branding.json에서 읽는다. */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(EMPTY);

  useEffect(() => {
    let alive = true;
    fetch('/branding.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (!alive || !j || typeof j !== 'object') return;
        const o = j as Record<string, unknown>;
        setBranding({
          productName: str(o.productName),
          productNameKo: str(o.productNameKo),
          companyName: str(o.companyName),
          logoUrl: str(o.logoUrl),
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = [branding.productNameKo, branding.productName].filter(Boolean).join(' · ');
    document.title = t || '통합관제';
  }, [branding]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const b = useBranding();
  return (
    <div className={'brand' + (compact ? ' brand-compact' : '')}>
      {b.logoUrl ? <img className="brand-logo" src={b.logoUrl} alt="" /> : null}
      <div className="brand-text">
        {b.productName ? <div className="brand-name">{b.productName}</div> : null}
        {b.productNameKo && !compact ? <div className="brand-sub">{b.productNameKo}</div> : null}
      </div>
    </div>
  );
}
