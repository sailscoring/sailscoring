ALTER TABLE "races" ADD COLUMN "conditions" jsonb;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "officials" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "officials" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "publish_officials" boolean DEFAULT false NOT NULL;