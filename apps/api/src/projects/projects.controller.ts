import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { buildExcel, sendExcel } from '../common/excel';
import { ZodPipe } from '../common/zod.pipe';
import { AssignmentsDto, CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

export const TRADE_LABEL = { ELECTRIC: '전기', TELECOM: '정보통신', BUILDING: '건축', COMPLEX: '복합' } as const;
export const STATUS_LABEL = { PLANNED: '예정', IN_PROGRESS: '진행', SUSPENDED: '중지', COMPLETED: '준공', SETTLED: '정산완료' } as const;
const ROLE_LABEL = { PRIME: '원도급', SUB: '하도급', JOINT: '공동도급' } as const;

@ApiTags('현장')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('project', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListProjectsQuery)) q: z.infer<typeof ListProjectsQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('options')
  @RequirePermission('project', 'read')
  options(@Ctx() ctx: AccessContext) {
    return this.svc.options(ctx);
  }

  @Get('export.xlsx')
  @RequirePermission('project', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListProjectsQuery)) q: z.infer<typeof ListProjectsQuery>, @Res() res: Response) {
    const data = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    const wb = await buildExcel({
      sheet: '현장목록',
      title: '현장 목록',
      rows: data.rows,
      columns: [
        { header: '공사관리번호', key: 'code', width: 13, value: (r) => r.code },
        { header: '공사명', key: 'name', width: 36, value: (r) => r.name },
        { header: '공사구분', key: 'trade', width: 9, value: (r) => TRADE_LABEL[r.tradeType] },
        { header: '도급구분', key: 'role', width: 9, value: (r) => ROLE_LABEL[r.contractRole] },
        { header: '상태', key: 'status', width: 9, value: (r) => STATUS_LABEL[r.status] },
        { header: '발주처', key: 'client', width: 20, value: (r) => r.clientName },
        { header: '계약일', key: 'cd', width: 12, type: 'date', value: (r) => r.contractDate },
        { header: '준공예정일', key: 'pe', width: 12, type: 'date', value: (r) => r.plannedEndDate },
        { header: '공급가액', key: 'supply', width: 16, type: 'money', value: (r) => r.supplyAmount },
        { header: '부가세', key: 'vat', width: 14, type: 'money', value: (r) => r.vatAmount },
        { header: '계약총액', key: 'total', width: 16, type: 'money', value: (r) => r.totalAmount },
        { header: '실행예산', key: 'budget', width: 16, type: 'money', value: (r) => r.executionBudget },
        { header: '계획이익', key: 'margin', width: 16, type: 'money', value: (r) => r.plannedMargin },
        { header: '공정률', key: 'progress', width: 9, type: 'rate', value: (r) => r.progressRate },
        { header: '현장소장', key: 'sm', width: 10, value: (r) => r.siteManagerName },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'project', summary: `현장 목록 엑셀 출력 ${data.rows.length}건` });
    await sendExcel(res, wb, `현장목록_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get(':id')
  @RequirePermission('project', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('project', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CreateProjectDto)) dto: z.infer<typeof CreateProjectDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('project', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateProjectDto)) dto: z.infer<typeof UpdateProjectDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('project', 'delete')
  async remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Query('version') version: string) {
    await this.svc.remove(ctx, id, Number(version));
  }

  @Put(':id/assignments')
  @RequirePermission('project', 'update')
  assign(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AssignmentsDto)) dto: z.infer<typeof AssignmentsDto>) {
    return this.svc.setAssignments(ctx, id, dto.members);
  }
}
