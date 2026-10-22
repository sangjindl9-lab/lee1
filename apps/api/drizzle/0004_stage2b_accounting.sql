CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fund_kind" AS ENUM('BANK', 'CARD', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('DRAFT', 'APPROVED', 'REVERSED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('TRANSFER', 'CASH', 'CARD', 'BILL', 'OFFSET');--> statement-breakpoint
CREATE TYPE "public"."payment_request_kind" AS ENUM('PURCHASE', 'SUBCONTRACT', 'EXPENSE', 'LABOR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_request_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."purchase_request_status" AS ENUM('REQUESTED', 'ORDERED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "accounting_period" (
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_by_name" text,
	"note" text,
	CONSTRAINT "accounting_period_company_id_period_pk" PRIMARY KEY("company_id","period")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"category" text NOT NULL,
	"needs_vendor" boolean DEFAULT false NOT NULL,
	"needs_project" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "fund_kind" DEFAULT 'BANK' NOT NULL,
	"name" text NOT NULL,
	"bank_name" text,
	"account_no_enc" text,
	"account_no_mask" text,
	"holder" text,
	"account_id" uuid NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"opening_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_alert_ack" (
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"level" text NOT NULL,
	"note" text,
	"acked_by_id" uuid NOT NULL,
	"acked_by_name" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alert_ack_project_id_cost_code_id_level_pk" PRIMARY KEY("project_id","cost_code_id","level")
);
--> statement-breakpoint
CREATE TABLE "budget_revision_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"before_amount" numeric(18, 2) NOT NULL,
	"after_amount" numeric(18, 2) NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "budget_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"reason" text,
	"status" "doc_status" DEFAULT 'DRAFT' NOT NULL,
	"total_before" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_after" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"trade_type" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"status" "journal_status" DEFAULT 'DRAFT' NOT NULL,
	"source_type" text DEFAULT 'MANUAL' NOT NULL,
	"source_id" uuid,
	"source_code" text,
	"purpose" text DEFAULT 'MAIN' NOT NULL,
	"reversal_of_id" uuid,
	"reversed_by_id" uuid,
	"total_debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_by_name" text,
	"void_reason" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"project_id" uuid,
	"vendor_id" uuid,
	"cost_code_id" uuid,
	"bank_account_id" uuid,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "payment_request_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"account_id" uuid,
	"cost_code_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"source_code" text,
	"active_source_key" text,
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_deductible" boolean DEFAULT true NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "payment_request_kind" NOT NULL,
	"title" text NOT NULL,
	"request_date" date NOT NULL,
	"due_date" date,
	"project_id" uuid,
	"vendor_id" uuid,
	"payee_name" text NOT NULL,
	"supply_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "payment_request_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"request_id" uuid NOT NULL,
	"pay_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" "payment_method" DEFAULT 'TRANSFER' NOT NULL,
	"bank_account_id" uuid,
	"memo" text,
	"status" "receipt_status" DEFAULT 'CONFIRMED' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posting_rule" (
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "posting_rule_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "project_budget" (
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_project_id_cost_code_id_pk" PRIMARY KEY("project_id","cost_code_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_request_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid,
	"name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "purchase_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"needed_by" date,
	"requester_name" text NOT NULL,
	"status" "purchase_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"po_id" uuid,
	"memo" text,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "cost_code_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alert_ack" ADD CONSTRAINT "budget_alert_ack_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alert_ack" ADD CONSTRAINT "budget_alert_ack_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision_line" ADD CONSTRAINT "budget_revision_line_revision_id_budget_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."budget_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision_line" ADD CONSTRAINT "budget_revision_line_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_code" ADD CONSTRAINT "cost_code_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_code" ADD CONSTRAINT "cost_code_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request_line" ADD CONSTRAINT "payment_request_line_request_id_payment_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."payment_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request_line" ADD CONSTRAINT "payment_request_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request_line" ADD CONSTRAINT "payment_request_line_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_request_id_payment_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."payment_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_bank_account_id_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_rule" ADD CONSTRAINT "posting_rule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_rule" ADD CONSTRAINT "posting_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget" ADD CONSTRAINT "project_budget_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget" ADD CONSTRAINT "project_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget" ADD CONSTRAINT "project_budget_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_request_id_purchase_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_company_code_uq" ON "account" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_rev_line_uq" ON "budget_revision_line" USING btree ("revision_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_rev_code_uq" ON "budget_revision" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "budget_rev_project_idx" ON "budget_revision" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_code_company_code_uq" ON "cost_code" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "je_company_code_uq" ON "journal_entry" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "je_company_date_idx" ON "journal_entry" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "je_source_idx" ON "journal_entry" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jl_entry_line_uq" ON "journal_line" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "jl_account_idx" ON "journal_line" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jl_project_idx" ON "journal_line" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jl_vendor_idx" ON "journal_line" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payreq_line_uq" ON "payment_request_line" USING btree ("request_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payreq_line_source_uq" ON "payment_request_line" USING btree ("active_source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payreq_company_code_uq" ON "payment_request" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "payreq_company_status_idx" ON "payment_request" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payreq_project_idx" ON "payment_request" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_company_code_uq" ON "payment" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "payment_request_idx" ON "payment" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_line_uq" ON "purchase_request_line" USING btree ("request_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_company_code_uq" ON "purchase_request" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "pr_project_idx" ON "purchase_request" USING btree ("project_id");