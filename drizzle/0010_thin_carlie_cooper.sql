-- Clear any historical duplicate unconfirmed referrals (keeping the newest per
-- conversation, i.e. the code most recently shown to the worker) so the
-- uniqueness guarantee below can build on existing data.
DELETE FROM "referrals" a
USING "referrals" b
WHERE a."confirmed_by_ngo" = false
  AND b."confirmed_by_ngo" = false
  AND a."conversation_id" = b."conversation_id"
  AND (a."created_at" < b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_active_conversation_uidx" ON "referrals" USING btree ("conversation_id") WHERE "referrals"."confirmed_by_ngo" = false;
