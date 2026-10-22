CREATE TYPE "public"."claim_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'INVOICED', 'PARTIAL', 'COLLECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."collection_kind" AS ENUM('ADVANCE', 'CLAIM', 'RETENTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."subcontract_status" AS ENUM('DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"claim_id" uuid,
	"code" text NOT NULL,
	"kind" "collection_kind" NOT NULL,
	"collect_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"bank_account_id" uuid,
	"bank_transaction_id" uuid,
	"memo" text,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"revision_no" integer NOT NULL,
	"revision_date" date NOT NULL,
	"reason" text NOT NULL,
	"before_supply" numeric(18, 2) NOT NULL,
	"delta_amount" numeric(18, 2) NOT NULL,
	"after_supply" numeric(18, 2) NOT NULL,
	"vat_rate" numeric(7, 4) NOT NULL,
	"delta_vat" numeric(18, 2) NOT NULL,
	"before_end_date" date,
	"after_end_date" date,
	"budget_lines" jsonb,
	"budget_revision_id" uuid,
	"status" "doc_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"work_type" text,
	"man_days" numeric(6, 2) DEFAULT '1' NOT NULL,
	"overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"daily_wage" numeric(18, 2) NOT NULL,
	"overtime_rate" numeric(7, 4) DEFAULT '1.5' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirm_batch_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_worker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'DAILY' NOT NULL,
	"trade" text,
	"phone" text,
	"resident_no_enc" text,
	"resident_no_mask" text,
	"bank_name" text,
	"bank_account_enc" text,
	"bank_account_mask" text,
	"daily_wage" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_claim_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"name" text NOT NULL,
	"spec" text,
	"unit" text,
	"contract_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"prev_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"this_amount" numeric(18, 2) NOT NULL,
	"cumulative_amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"code" text NOT NULL,
	"claim_no" integer NOT NULL,
	"claim_date" date NOT NULL,
	"period_from" date,
	"period_to" date,
	"due_date" date,
	"contract_supply" numeric(18, 2) NOT NULL,
	"prev_cumulative" numeric(18, 2) NOT NULL,
	"this_supply" numeric(18, 2) NOT NULL,
	"cumulative" numeric(18, 2) NOT NULL,
	"progress_rate" numeric(7, 4) NOT NULL,
	"vat_rate" numeric(7, 4) NOT NULL,
	"vat_amount" numeric(18, 2) NOT NULL,
	"advance_deduction" numeric(18, 2) DEFAULT '0' NOT NULL,
	"retention_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"retention_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"receivable_amount" numeric(18, 2) NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"status" "claim_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"settle_date" date NOT NULL,
	"final_contract" numeric(18, 2) NOT NULL,
	"total_claimed" numeric(18, 2) NOT NULL,
	"total_collected" numeric(18, 2) NOT NULL,
	"receivable" numeric(18, 2) NOT NULL,
	"total_cost" numeric(18, 2) NOT NULL,
	"total_paid" numeric(18, 2) NOT NULL,
	"unpaid" numeric(18, 2) NOT NULL,
	"profit" numeric(18, 2) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'SETTLED' NOT NULL,
	"memo" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"code" text NOT NULL,
	"claim_no" integer NOT NULL,
	"claim_date" date NOT NULL,
	"prev_cumulative" numeric(18, 2) NOT NULL,
	"this_amount" numeric(18, 2) NOT NULL,
	"cumulative" numeric(18, 2) NOT NULL,
	"progress_rate" numeric(7, 4) NOT NULL,
	"vat_amount" numeric(18, 2) NOT NULL,
	"retention_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payable_amount" numeric(18, 2) NOT NULL,
	"status" "doc_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontract_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"revision_date" date NOT NULL,
	"before_amount" numeric(18, 2) NOT NULL,
	"delta_amount" numeric(18, 2) NOT NULL,
	"after_amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "subcontract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"contract_date" date NOT NULL,
	"start_date" date,
	"end_date" date,
	"original_amount" numeric(18, 2) NOT NULL,
	"current_amount" numeric(18, 2) NOT NULL,
	"vat_rate" numeric(7, 4) NOT NULL,
	"retention_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"progress_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"guarantee_type" text,
	"guarantee_no" text,
	"guarantee_amount" numeric(18, 2),
	"guarantee_expiry" date,
	"status" "subcontract_status" DEFAULT 'DRAFT' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"scope" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "client_vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "advance_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "retention_rate" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_claim_id_progress_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."progress_claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_bank_account_id_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision" ADD CONSTRAINT "contract_revision_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision" ADD CONSTRAINT "contract_revision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_record" ADD CONSTRAINT "labor_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_record" ADD CONSTRAINT "labor_record_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_record" ADD CONSTRAINT "labor_record_worker_id_labor_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."labor_worker"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_record" ADD CONSTRAINT "labor_record_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_worker" ADD CONSTRAINT "labor_worker_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_claim_line" ADD CONSTRAINT "progress_claim_line_claim_id_progress_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."progress_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_claim" ADD CONSTRAINT "progress_claim_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_claim" ADD CONSTRAINT "progress_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_claim" ADD CONSTRAINT "progress_claim_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_settlement" ADD CONSTRAINT "project_settlement_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_settlement" ADD CONSTRAINT "project_settlement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_subcontract_id_subcontract_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_revision" ADD CONSTRAINT "subcontract_revision_subcontract_id_subcontract_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract" ADD CONSTRAINT "subcontract_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract" ADD CONSTRAINT "subcontract_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract" ADD CONSTRAINT "subcontract_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract" ADD CONSTRAINT "subcontract_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_code_uq" ON "collection" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "collection_project_idx" ON "collection" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "collection_claim_idx" ON "collection" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_revision_code_uq" ON "contract_revision" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "contract_revision_project_idx" ON "contract_revision" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "labor_record_project_idx" ON "labor_record" USING btree ("project_id","work_date");--> statement-breakpoint
CREATE INDEX "labor_record_worker_idx" ON "labor_record" USING btree ("worker_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "labor_worker_code_uq" ON "labor_worker" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_claim_line_uq" ON "progress_claim_line" USING btree ("claim_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_claim_code_uq" ON "progress_claim" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "progress_claim_project_idx" ON "progress_claim" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_settlement_project_idx" ON "project_settlement" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_claim_code_uq" ON "sub_claim" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "sub_claim_sub_idx" ON "sub_claim" USING btree ("subcontract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontract_revision_uq" ON "subcontract_revision" USING btree ("subcontract_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontract_code_uq" ON "subcontract" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "subcontract_project_idx" ON "subcontract" USING btree ("project_id");