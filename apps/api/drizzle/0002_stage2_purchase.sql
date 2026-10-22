CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'HOLD', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_step_state" AS ENUM('WAITING', 'APPROVED', 'REJECTED', 'HOLD', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('TAXABLE', 'EXEMPT', 'ZERO');--> statement-breakpoint
CREATE TABLE "approval_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"min_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"title" text NOT NULL,
	"role_key" text,
	"approver_names" text,
	"state" "approval_step_state" DEFAULT 'WAITING' NOT NULL,
	"acted_by_id" uuid,
	"acted_by_name" text,
	"acted_at" timestamp with time zone,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_code" text,
	"title" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"project_id" uuid,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"drafter_id" uuid NOT NULL,
	"drafter_name" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"po_line_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"receipt_date" date NOT NULL,
	"inspector_name" text,
	"memo" text,
	"status" "receipt_status" DEFAULT 'CONFIRMED' NOT NULL,
	"supply_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"spec" text,
	"maker" text,
	"unit" text DEFAULT 'EA' NOT NULL,
	"category" text,
	"trade_type" text,
	"default_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_type" "tax_type" DEFAULT 'TAXABLE' NOT NULL,
	"memo" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid,
	"name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"supply_amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) NOT NULL,
	"tax_type" "tax_type" DEFAULT 'TAXABLE' NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"code" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"order_date" date NOT NULL,
	"delivery_date" date,
	"delivery_place" text,
	"payment_terms" text,
	"our_contact" text,
	"our_phone" text,
	"vendor_contact" text,
	"memo" text,
	"status" "po_status" DEFAULT 'DRAFT' NOT NULL,
	"supply_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(7, 4) NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_price" (
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"last_order_id" uuid,
	"last_order_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_price_vendor_id_material_id_pk" PRIMARY KEY("vendor_id","material_id")
);
--> statement-breakpoint
ALTER TABLE "approval_line" ADD CONSTRAINT "approval_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_receipt_id_goods_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_po_line_id_purchase_order_line_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_po_id_purchase_order_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_po_id_purchase_order_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_price" ADD CONSTRAINT "vendor_price_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_price" ADD CONSTRAINT "vendor_price_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_price" ADD CONSTRAINT "vendor_price_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_line_uq" ON "approval_line" USING btree ("company_id","doc_type","min_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_step_uq" ON "approval_step" USING btree ("approval_id","step_no");--> statement-breakpoint
CREATE INDEX "approval_company_status_idx" ON "approval" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "approval_doc_idx" ON "approval" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gr_company_code_uq" ON "goods_receipt" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "gr_po_idx" ON "goods_receipt" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_company_code_uq" ON "material" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "material_company_name_idx" ON "material" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "po_line_uq" ON "purchase_order_line" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "po_company_code_uq" ON "purchase_order" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "po_company_status_idx" ON "purchase_order" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "po_project_idx" ON "purchase_order" USING btree ("project_id");