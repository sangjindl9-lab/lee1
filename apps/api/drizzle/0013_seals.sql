CREATE TYPE "public"."seal_kind" AS ENUM('COMPANY', 'CEO', 'USER');--> statement-breakpoint
CREATE TABLE "seal_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "seal_kind" NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_step" ADD COLUMN "acted_stamp_id" uuid;--> statement-breakpoint
ALTER TABLE "seal_image" ADD CONSTRAINT "seal_image_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_image" ADD CONSTRAINT "seal_image_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seal_company_idx" ON "seal_image" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "seal_user_idx" ON "seal_image" USING btree ("user_id","kind");