CREATE TYPE "public"."client_sector" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."contract_role" AS ENUM('PRIME', 'SUB', 'JOINT');--> statement-breakpoint
CREATE TYPE "public"."data_scope" AS ENUM('COMPANY', 'ASSIGNED', 'CONFIRMED_ONLY');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."trade_type" AS ENUM('ELECTRIC', 'TELECOM', 'BUILDING', 'COMPLEX');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'LOCKED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."vendor_biz_status" AS ENUM('UNKNOWN', 'ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."vendor_type" AS ENUM('SUPPLIER', 'SUBCONTRACTOR', 'CLIENT', 'BOTH');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_log_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"biz_reg_no" text NOT NULL,
	"ceo_name" text,
	"address" text,
	"phone" text,
	"email" text,
	"business_type" text,
	"business_item" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_code_unique" UNIQUE("code"),
	CONSTRAINT "company_biz_reg_no_unique" UNIQUE("biz_reg_no")
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"vendor_id" uuid,
	"category" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_object_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "license_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"license_text" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_role" (
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "membership_role_membership_id_role_id_pk" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"department" text,
	"position" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequence" (
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequence_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "project_assignment" (
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role_in_project" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_assignment_membership_id_project_id_pk" PRIMARY KEY("membership_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"status" "project_status" DEFAULT 'PLANNED' NOT NULL,
	"contract_role" "contract_role" DEFAULT 'PRIME' NOT NULL,
	"client_sector" "client_sector" DEFAULT 'PRIVATE' NOT NULL,
	"client_name" text,
	"prime_contractor" text,
	"sub_contractor" text,
	"site_address" text,
	"contract_type" text,
	"contract_date" date,
	"start_date" date,
	"planned_end_date" date,
	"actual_end_date" date,
	"supply_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(7, 4) NOT NULL,
	"execution_budget" numeric(18, 2) DEFAULT '0' NOT NULL,
	"joint_share_rate" numeric(7, 4),
	"progress_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"manager_name" text,
	"site_manager_name" text,
	"memo" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "role_permission_role_id_resource_action_pk" PRIMARY KEY("role_id","resource","action")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" "data_scope" DEFAULT 'ASSIGNED' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rate_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"note" text,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"mfa_pending" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_system_admin" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "app_user_login_id_unique" UNIQUE("login_id")
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"vendor_type" "vendor_type" DEFAULT 'SUPPLIER' NOT NULL,
	"biz_reg_no" text,
	"ceo_name" text,
	"address" text,
	"business_type" text,
	"business_item" text,
	"contact_name" text,
	"contact_phone" text,
	"email" text,
	"phone" text,
	"fax" text,
	"bank_name" text,
	"bank_account_enc" text,
	"bank_account_mask" text,
	"bank_holder" text,
	"payment_terms" text,
	"biz_status" "vendor_biz_status" DEFAULT 'UNKNOWN' NOT NULL,
	"biz_status_checked_at" timestamp with time zone,
	"memo" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequence" ADD CONSTRAINT "number_sequence_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_company_created_idx" ON "audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_log" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "file_company_project_idx" ON "file_object" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "file_company_vendor_idx" ON "file_object" USING btree ("company_id","vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_company_user_uq" ON "membership" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_company_code_uq" ON "project" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "project_company_status_idx" ON "project" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "role_company_key_uq" ON "role" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_key_from_uq" ON "tax_rate_setting" USING btree ("key","effective_from");--> statement-breakpoint
CREATE INDEX "user_session_user_idx" ON "user_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_company_code_uq" ON "vendor" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "vendor_company_name_idx" ON "vendor" USING btree ("company_id","name");