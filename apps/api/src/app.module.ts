import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessService } from './access/access.service';
import { CompaniesController, CompaniesService } from './admin/companies';
import { RolesController, RolesService } from './admin/roles';
import { AuditController, HealthController, LicenseController, TaxRateController } from './admin/system';
import { MembersController, UsersController, UsersService } from './admin/users';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ErpGuard } from './auth/erp.guard';
import { AllExceptionsFilter } from './common/errors';
import { NumberingService, TaxRateService } from './common/numbering.service';
import { config } from './config';
import { DashboardController, DashboardService } from './dashboard/dashboard';
import { DbModule } from './db/db.module';
import { FilesController, FilesService } from './files/files';
import { LicenseService } from './license/license.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { VendorsController, VendorsService } from './vendors/vendors';
import { MaterialsController, MaterialsService } from './materials/materials';
import { ApprovalsController, ApprovalsService } from './approvals/approvals';
import { PurchaseController } from './purchase/purchase.controller';
import { PurchaseService } from './purchase/purchase.service';
import { PurchaseRequestsController, PurchaseRequestsService } from './purchase/requests';
import { LedgerService } from './accounting/ledger.service';
import { JournalsController, JournalsService } from './accounting/journals';
import { LedgerReportsController, LedgerReportsService } from './accounting/reports';
import { ClosingController, ClosingService } from './accounting/closing';
import { BankAccountsController, BankAccountsService } from './bank/accounts';
import { PaymentsController, PaymentsService } from './payments/payments';
import { BudgetController, BudgetService } from './budget/budget';
import { IntegrationsController, IntegrationsService } from './integrations/integrations';
import { TaxInvoicesService } from './taxinvoices/taxinvoices.service';
import { TaxInvoicesController } from './taxinvoices/taxinvoices.controller';
import { HometaxCollectService } from './taxinvoices/collect.service';
import { DocumentsController, DocumentsService } from './documents/documents';
import { ContractRevisionsController, ContractRevisionsService } from './construction/contracts';
import { ClaimsController, ClaimsService } from './construction/claims';
import { SubcontractsController, SubcontractsService } from './construction/subcontracts';
import { LaborController, LaborService } from './construction/labor';
import { SettlementController, SettlementService } from './construction/settlement';
import { BankTransactionsController, BankTransactionsService } from './bank/transactions';
import { CashController, CashService } from './bank/cash';
import { ApiKeysController, ApiKeysService, IdempotencyInterceptor } from './platform/apikeys';
import { WebhooksController, WebhooksService } from './platform/webhooks';
import { ReportsController, ReportsService } from './reports/reports';
import { BackupsController, BackupsService } from './admin/backups';

@Module({
  imports: [
    DbModule,
    // 일반 API: 사용자(IP)당 분당 300회. 로그인 등은 컨트롤러에서 더 엄격하게 제한
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: config.NODE_ENV === 'test' ? 100_000 : 300 }] }),
  ],
  controllers: [
    HealthController, AuthController, CompaniesController, UsersController, MembersController, RolesController,
    ProjectsController, VendorsController, MaterialsController, PurchaseController, PurchaseRequestsController, ApprovalsController,
    JournalsController, LedgerReportsController, ClosingController, BankAccountsController, PaymentsController, BudgetController, IntegrationsController, TaxInvoicesController, DocumentsController, ContractRevisionsController, ClaimsController, SubcontractsController, LaborController, SettlementController, BankTransactionsController, CashController, ApiKeysController, WebhooksController, ReportsController, BackupsController, FilesController, DashboardController, AuditController, LicenseController, TaxRateController,
  ],
  providers: [
    AuditService, AccessService, AuthService, LicenseService, NumberingService, TaxRateService,
    CompaniesService, UsersService, RolesService, ProjectsService, VendorsService, MaterialsService, ApprovalsService, PurchaseService, PurchaseRequestsService,
    LedgerService, JournalsService, LedgerReportsService, ClosingService, BankAccountsService, PaymentsService, BudgetService, IntegrationsService, TaxInvoicesService, HometaxCollectService, DocumentsService, ContractRevisionsService, ClaimsService, SubcontractsService, LaborService, SettlementService, BankTransactionsService, CashService, ApiKeysService, WebhooksService, ReportsService, BackupsService, FilesService, DashboardService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ErpGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
