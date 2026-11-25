CREATE TABLE "voice_recording_segments" (
	"recording_id" uuid NOT NULL,
	"take" integer NOT NULL,
	"index" integer NOT NULL,
	"audio" "bytea" NOT NULL,
	CONSTRAINT "voice_recording_segments_recording_id_take_index_pk" PRIMARY KEY("recording_id","take","index")
);
--> statement-breakpoint
CREATE TABLE "voice_recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"race_id" uuid NOT NULL,
	"submission_id" uuid,
	"recorded_by_user_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "voice_recording_segments" ADD CONSTRAINT "voice_recording_segments_recording_id_voice_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."voice_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD CONSTRAINT "voice_recordings_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD CONSTRAINT "voice_recordings_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_recordings_race_idx" ON "voice_recordings" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "voice_recordings_submission_idx" ON "voice_recordings" USING btree ("submission_id");