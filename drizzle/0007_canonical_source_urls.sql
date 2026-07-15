ALTER TABLE "content_items" ADD COLUMN "source_url" text;
--> statement-breakpoint
UPDATE "content_items"
SET "source_url" = "source_ref"
WHERE "source_ref" ~* '^https://[^[:space:]]+$';
