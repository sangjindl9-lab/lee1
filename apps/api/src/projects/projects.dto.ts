import { z } from 'zod';

const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/,/g, '').trim())
  .refine((v) => /^\d{1,16}(\.\d{1,2})?$/.test(v), '0 이상의 금액을 숫자로 입력해 주세요');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다');
const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optDate = dateStr.optional().nullable().or(z.literal('').transform(() => null));

export const ProjectBase = z.object({
  name: z.string().trim().min(2, '공사명을 2자 이상 입력해 주세요').max(200),
  tradeType: z.enum(['ELECTRIC', 'TELECOM', 'BUILDING', 'COMPLEX'], { message: '공사구분을 선택해 주세요' }),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'SETTLED']).default('PLANNED'),
  contractRole: z.enum(['PRIME', 'SUB', 'JOINT']).default('PRIME'),
  clientSector: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
  clientName: optText(),
  primeContractor: optText(),
  subContractor: optText(),
  siteAddress: optText(300),
  contractType: optText(50),
  contractDate: optDate,
  startDate: optDate,
  plannedEndDate: optDate,
  actualEndDate: optDate,
  supplyAmount: amount,
  /** 비워 두면 서버가 세율로 계산. 입력하면 계산값과 단수차이(±10원) 이내인지 검증 */
  vatAmount: amount.optional().nullable(),
  executionBudget: amount.default('0'),
  jointShareRate: z.coerce.number().min(0).max(100).optional().nullable(), // % 입력
  progressRate: z.coerce.number().min(0, '공정률은 0~100 사이').max(100, '공정률은 0~100 사이').default(0), // % 입력
  managerName: optText(50),
  siteManagerName: optText(50),
  memo: optText(2000),
});

function dateOrder(v: z.infer<typeof ProjectBase>, ctx: z.RefinementCtx) {
  if (v.startDate && v.plannedEndDate && v.plannedEndDate < v.startDate) {
    ctx.addIssue({ code: 'custom', path: ['plannedEndDate'], message: '준공예정일이 착공일보다 빠릅니다' });
  }
  if (v.startDate && v.actualEndDate && v.actualEndDate < v.startDate) {
    ctx.addIssue({ code: 'custom', path: ['actualEndDate'], message: '실제 준공일이 착공일보다 빠릅니다' });
  }
  if (v.contractRole === 'JOINT' && (v.jointShareRate === null || v.jointShareRate === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['jointShareRate'], message: '공동도급은 지분율을 입력해 주세요' });
  }
  if ((v.status === 'COMPLETED' || v.status === 'SETTLED') && !v.actualEndDate) {
    ctx.addIssue({ code: 'custom', path: ['actualEndDate'], message: '준공·정산완료 상태는 실제 준공일이 필요합니다' });
  }
}

export const CreateProjectDto = ProjectBase.superRefine(dateOrder);
export const UpdateProjectDto = ProjectBase.extend({ version: z.coerce.number().int().positive() }).superRefine(dateOrder);
export type CreateProject = z.infer<typeof CreateProjectDto>;
export type UpdateProject = z.infer<typeof UpdateProjectDto>;

export const ListProjectsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'SETTLED']).optional(),
  tradeType: z.enum(['ELECTRIC', 'TELECOM', 'BUILDING', 'COMPLEX']).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  sort: z.enum(['code', 'name', 'contractDate', 'totalAmount', 'plannedEndDate', 'progressRate']).default('code'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});

export const AssignmentsDto = z.object({
  members: z.array(z.object({ membershipId: z.string().uuid(), roleInProject: z.string().trim().max(30).optional().nullable() })).max(200),
});
