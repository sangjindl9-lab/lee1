import { z } from 'zod';

const dec = (scale: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v ?? '').replace(/,/g, '').trim())
    .refine((v) => new RegExp(`^\\d{1,14}(\\.\\d{1,${scale}})?$`).test(v), `${label}는 0 이상의 숫자로 입력해 주세요 (소수 ${scale}자리까지)`);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다');
const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optDate = dateStr.optional().nullable().or(z.literal('').transform(() => null));

export const PoLineDto = z.object({
  materialId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, '품명을 입력해 주세요').max(200),
  spec: optText(200),
  unit: z.string().trim().min(1, '단위를 입력해 주세요').max(20),
  qty: dec(4, '수량').refine((v) => Number(v) > 0, '수량은 0보다 커야 합니다'),
  unitPrice: dec(4, '단가'),
  taxType: z.enum(['TAXABLE', 'EXEMPT', 'ZERO']).default('TAXABLE'),
  memo: optText(200),
});

const PoBase = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  vendorId: z.string().uuid('거래처를 선택해 주세요'),
  title: z.string().trim().min(1, '발주 제목을 입력해 주세요').max(200),
  orderDate: dateStr,
  deliveryDate: optDate,
  deliveryPlace: optText(300),
  paymentTerms: optText(100),
  ourContact: optText(50),
  ourPhone: optText(30),
  vendorContact: optText(50),
  memo: optText(2000),
  costCodeId: z.string().uuid().optional().nullable(),
  requestId: z.string().uuid().optional().nullable(),
  lines: z.array(PoLineDto).min(1, '품목을 하나 이상 입력해 주세요').max(300, '한 발주서에 300개 품목까지 넣을 수 있습니다'),
});
const order = (v: { orderDate: string; deliveryDate?: string | null }, ctx: z.RefinementCtx) => {
  if (v.deliveryDate && v.deliveryDate < v.orderDate) ctx.addIssue({ code: 'custom', path: ['deliveryDate'], message: '납품기한이 발주일보다 빠릅니다' });
};
export const CreatePoDto = PoBase.superRefine(order);
export const UpdatePoDto = PoBase.extend({ version: z.coerce.number().int().positive() }).superRefine(order);
export type CreatePo = z.infer<typeof CreatePoDto>;

export const ListPoQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED', 'OPEN']).optional(),
  projectId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});

export const VersionDto = z.object({ version: z.coerce.number().int().positive() });
export const ReasonDto = VersionDto.extend({ reason: z.string().trim().min(2, '사유를 입력해 주세요').max(500) });

export const ReceiptDto = z.object({
  receiptDate: dateStr,
  inspectorName: optText(50),
  memo: optText(1000),
  lines: z.array(z.object({ poLineId: z.string().uuid(), qty: dec(4, '검수 수량'), note: optText(200) })).min(1, '검수할 품목을 하나 이상 입력해 주세요'),
});
export const ListReceiptQuery = z.object({
  projectId: z.string().uuid().optional(),
  poId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});
