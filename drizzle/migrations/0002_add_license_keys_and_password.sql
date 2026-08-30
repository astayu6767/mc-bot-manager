-- Add password_hash to users for local auth
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text DEFAULT '' NOT NULL;

-- Add license_key to licenses if not exists
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "license_key" text DEFAULT '' NOT NULL;

-- Create license_keys table for redeemable keys like abeam-key-xxx
CREATE TABLE IF NOT EXISTS "license_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL UNIQUE,
	"slots" integer DEFAULT 1 NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"duration_hours" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"active" text DEFAULT 'true' NOT NULL,
	"redeemed" text DEFAULT 'false' NOT NULL,
	"redeemed_by" uuid REFERENCES "users"("id"),
	"redeemed_at" timestamp,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);
