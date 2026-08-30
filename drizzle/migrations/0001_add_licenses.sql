-- Set default bot_slots to 0 (license system)
ALTER TABLE "users" ALTER COLUMN "bot_slots" SET DEFAULT 0;

-- Add missing bot columns if not exists (from later schema additions)
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "discord_user" text DEFAULT 'stood014' NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "engine" text DEFAULT 'azalea' NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "beam_type" text DEFAULT 'ai' NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "spam_message" text DEFAULT 'join my smp guys /msg me' NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "spam_interval" integer DEFAULT 60000 NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "spam_trigger_word" text DEFAULT '123' NOT NULL;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "spam_reply_message" text DEFAULT 'add my discord stood014 to join' NOT NULL;

-- Licenses table
CREATE TABLE IF NOT EXISTS "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"slots" integer DEFAULT 1 NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"duration_hours" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"active" text DEFAULT 'true' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);
