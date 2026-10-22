CREATE TYPE "public"."document_status" AS ENUM('UPLOADED', 'EXTRACTED', 'FAILED', 'REGISTERED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."tax_direction" AS ENUM('SALES', 'PURCHASE');--> statement-breakpoint
CREATE TYPE "public"."tax_invoice_status" AS ENUM('COLLECTED', 'POSTED', 'IGNORED', 'DRAFT', 'PENDING', 'READY', 'ISSUED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"doc_type" text NOT NULL,
	"file_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"status" "document_status" DEFAULT 'UPLOADED' NOT NULL,
	"project_id" uuid,
	"vendor_id" uuid,
	"provider" text,
	"provider_mode" text,
	"confidence" numeric(7, 4),
	"extracted" jsonb,
	"reviewed" jsonb,
	"duplicate_key" text,
	"duplicate_of_id" uuid,
	"registered_type" text,
	"registered_id" uuid,
	"error_message" text,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'TEST' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"secret_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_by_name" text
);
--> statement-breakpoint
CREATE TABLE "tax_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_date" date,
	"name" text,
	"spec" text,
	"qty" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"remark" text
);
--> statement-breakpoint
CREATE TABLE "tax_invoice_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tax_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" "tax_direction" NOT NULL,
	"doc_kind" text DEFAULT 'TAX' NOT NULL,
	"invoice_type" text,
	"status" "tax_invoice_status" NOT NULL,
	"code" text NOT NULL,
	"approval_no" text,
	"write_date" date NOT NULL,
	"issue_date" date,
	"send_date" date,
	"purpose" text DEFAULT 'CHARGE' NOT NULL,
	"supplier_biz_no" text,
	"supplier_name" text,
	"supplier_ceo" text,
	"supplier_address" text,
	"supplier_biz_type" text,
	"supplier_biz_item" text,
	"supplier_email" text,
	"buyer_biz_no" text,
	"buyer_name" text,
	"buyer_ceo" text,
	"buyer_address" text,
	"buyer_biz_type" text,
	"buyer_biz_item" text,
	"buyer_email" text,
	"vendor_id" uuid,
	"project_id" uuid,
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"remark" text,
	"modify_reason" text,
	"original_approval_no" text,
	"source" text NOT NULL,
	"provider" text,
	"provider_mode" text,
	"provider_key" text,
	"nts_status" text,
	"nts_message" text,
	"dedupe_key" text NOT NULL,
	"matched_supply" numeric(18, 2),
	"match_diff" numeric(18, 2),
	"match_note" text,
	"account_id" uuid,
	"cost_code_id" uuid,
	"vat_deductible" boolean DEFAULT true NOT NULL,
	"claim_id" uuid,
	"approval_id" uuid,
	"raw" jsonb,
	"posted_at" timestamp with time zone,
	"ignored_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_config" ADD CONSTRAINT "integration_config_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_job" ADD CONSTRAINT "integration_job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_line" ADD CONSTRAINT "tax_invoice_line_invoice_id_tax_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."tax_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_match" ADD CONSTRAINT "tax_invoice_match_invoice_id_tax_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."tax_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD CONSTRAINT "tax_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD CONSTRAINT "tax_invoice_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD CONSTRAINT "tax_invoice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD CONSTRAINT "tax_invoice_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD CONSTRAINT "tax_invoice_cost_code_id_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_code_uq" ON "document" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "document_company_status_idx" ON "document" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_company_kind_uq" ON "integration_config" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "integration_job_company_idx" ON "integration_job" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_line_uq" ON "tax_invoice_line" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_match_uq" ON "tax_invoice_match" USING btree ("invoice_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "tax_invoice_match_source_idx" ON "tax_invoice_match" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_code_uq" ON "tax_invoice" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "tax_invoice_company_dir_idx" ON "tax_invoice" USING btree ("company_id","direction","write_date");--> statement-breakpoint
CREATE INDEX "tax_invoice_vendor_idx" ON "tax_invoice" USING btree ("vendor_id");