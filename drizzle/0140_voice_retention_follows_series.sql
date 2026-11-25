DROP INDEX "voice_recordings_expires_idx";--> statement-breakpoint
ALTER TABLE "voice_recordings" DROP COLUMN "expires_at";