import Link from "next/link";
import { formatKrw } from "@/lib/money";
import type { Product, SellerProfile } from "@prisma/client";

export function Badge({
  children,
  tone = "navy",
}: {
  children: React.ReactNode;
  tone?: "navy" | "green" | "amber" | "red" | "gray" | "blue";
}) {
  const tones: Record<string, string> = {
    navy: "bg-[#eaf0f9] text-[#16355c]",
    green: "bg-[#e7f6ee] text-[#17703f]",
    amber: "bg-[#fff4e0] text-[#8a5a00]",
    red: "bg-[#fdecec] text-[#a32626]",
    gray: "bg-[#f1f3f7] text-[#5a6a80]",
    blue: "bg-[#e8f1ff] text-[#1e63d0]",
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={className}>{formatKrw(amount)}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-tint)] px-6 py-12 text-center">
      <div className="text-[0.9375rem] font-bold text-[var(--color-navy)]">{title}</div>
      {description && <p className="mt-2 text-[0.8125rem] text-[#5a6a80]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="section-title">{title}</h2>
        {description && <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ProductCard({
  product,
}: {
  product: Product & { seller: SellerProfile };
}) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="card flex h-full flex-col p-5 transition hover:border-[var(--color-navy)] hover:shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={product.type === "SOURCE" ? "blue" : "navy"}>
          {product.type === "SOURCE" ? "소스코드" : "솔루션"}
        </Badge>
        <Badge tone="gray">{product.category}</Badge>
        {product.sourceIncluded && <Badge tone="green">소스 포함</Badge>}
        {product.installSupport && <Badge tone="green">설치 지원</Badge>}
        {product.customization && <Badge tone="amber">커스터마이징</Badge>}
      </div>
      <h3 className="mt-3 line-clamp-2 text-[1rem] font-bold leading-snug text-[var(--color-navy)]">
        {product.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-[0.8125rem] leading-relaxed text-[#5a6a80]">{product.summary}</p>
      <div className="mt-auto pt-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[0.6875rem] text-[#8c98aa]">{product.seller.displayName}</div>
            <div className="text-[1.0625rem] font-extrabold text-[var(--color-navy)]">
              {formatKrw(product.priceKrw)}
              <span className="ml-1 text-[0.6875rem] font-medium text-[#8c98aa]">
                {product.licenseType === "PERIOD" ? `/${product.licenseMonths ?? 12}개월` : "/영구"}
              </span>
            </div>
          </div>
          <div className="text-right text-[0.6875rem] text-[#8c98aa]">
            {product.ratingCount > 0 ? `★ ${product.ratingAvg.toFixed(1)} (${product.ratingCount})` : "후기 없음"}
            <br />
            검수 {product.inspectionDays}일
          </div>
        </div>
      </div>
    </Link>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-[#cfe0fa] bg-[#f3f8ff] text-[#20456f]",
    warn: "border-[#f3e0b8] bg-[#fffaf0] text-[#7a5510]",
    danger: "border-[#f3cccc] bg-[#fff5f5] text-[#8f2b2b]",
    success: "border-[#c4e6d3] bg-[#f3fbf6] text-[#1c6b43]",
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-[0.8125rem] leading-relaxed ${tones[tone]}`}>
      {title && <div className="mb-1 font-bold">{title}</div>}
      {children}
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required,
  value,
  placeholder,
  defaultValue,
  hint,
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  value?: string | number;
  placeholder?: string;
  defaultValue?: string | number;
  hint?: string;
  min?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-0.5 text-[#c0392b]">*</span>}
      </span>
      <input
        className="input"
        name={name}
        type={type}
        required={required}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        step={step}
      />
      {hint && <span className="mt-1 block text-[0.6875rem] text-[#8c98aa]">{hint}</span>}
    </label>
  );
}
