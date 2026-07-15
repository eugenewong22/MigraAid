CREATE TABLE "daily_metrics" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"locale" text DEFAULT 'all' NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metrics_day_metric_locale_pk" PRIMARY KEY("day","metric","locale"),
	CONSTRAINT "daily_metrics_value_check" CHECK ("daily_metrics"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE public."daily_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."content_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."content_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."contract_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."orgs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."referrals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "metadata" jsonb;
ALTER TABLE "content_items" ADD COLUMN "last_edited_by" text;
ALTER TABLE "content_items" ADD COLUMN "submitted_by" text;
ALTER TABLE "content_items" ADD COLUMN "submitted_version" integer;
ALTER TABLE "content_items" ADD COLUMN "reviewed_by" text;
ALTER TABLE "content_items" ADD COLUMN "reviewed_at" timestamp with time zone;
ALTER TABLE "content_items" ADD COLUMN "review_note" text;
ALTER TABLE "conversations" ADD COLUMN "last_activity_at" timestamp with time zone;
ALTER TABLE "feedback" ADD COLUMN "message_id" uuid;
ALTER TABLE "referrals" ADD COLUMN "handoff_code_hash" text;
ALTER TABLE "referrals" ADD COLUMN "expires_at" timestamp with time zone;
ALTER TABLE "referrals" ADD COLUMN "confirmed_at" timestamp with time zone;
ALTER TABLE "referrals" ADD COLUMN "confirmed_by" text;
--> statement-breakpoint
-- Preserve the latest real activity for existing chats instead of resetting the
-- retention clock to either the first message or the migration time.
UPDATE "conversations" AS c
SET "last_activity_at" = GREATEST(
	c."started_at",
	COALESCE(
		(SELECT MAX(m."created_at") FROM "messages" AS m WHERE m."conversation_id" = c."id"),
		c."started_at"
	)
);
ALTER TABLE "conversations" ALTER COLUMN "last_activity_at" SET DEFAULT now();
ALTER TABLE "conversations" ALTER COLUMN "last_activity_at" SET NOT NULL;
--> statement-breakpoint
-- Legacy rows never had a worker-visible handoff code. Give them an unexposed,
-- already-expired digest so they cannot be confirmed through the new workflow.
UPDATE "referrals"
SET
	"handoff_code_hash" = md5('legacy:' || "id"::text),
	"expires_at" = "created_at",
	"outcome" = CASE
		WHEN "confirmed_by_ngo" THEN 'legacy_unverified'
		ELSE COALESCE("outcome", 'surfaced')
	END,
	"confirmed_by_ngo" = false,
	"confirmed_at" = NULL,
	"confirmed_by" = NULL;
--> statement-breakpoint
-- Map legacy ratings to the closest assistant response. Ambiguous duplicates
-- are reduced to the newest rating; rows with no owned answer are discarded.
UPDATE "feedback" AS f
SET "message_id" = (
	SELECT m."id"
	FROM "messages" AS m
	WHERE m."conversation_id" = f."conversation_id"
		AND m."role" = 'assistant'
	ORDER BY ABS(EXTRACT(EPOCH FROM (m."created_at" - f."created_at"))), m."created_at" DESC
	LIMIT 1
);
DELETE FROM "feedback" AS f
USING (
	SELECT "id", ROW_NUMBER() OVER (
		PARTITION BY "message_id" ORDER BY "created_at" DESC, "id" DESC
	) AS row_number
	FROM "feedback"
	WHERE "message_id" IS NOT NULL
) AS ranked
WHERE f."id" = ranked."id" AND ranked.row_number > 1;
--> statement-breakpoint
-- Backfill retention-proof, non-identifying impact totals before cleaning any
-- legacy orphan records.
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "started_at"::date, 'conversations', "lang", COUNT(*)::integer
FROM "conversations"
GROUP BY "started_at"::date, "lang";
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT first_seen::date, 'unique_workers', "lang", COUNT(*)::integer
FROM (
	SELECT DISTINCT ON ("anon_session_id") "started_at" AS first_seen, "lang"
	FROM "conversations"
	ORDER BY "anon_session_id", "started_at"
) AS first_workers
GROUP BY first_seen::date, "lang";
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "created_at"::date, 'contracts_explained', "lang", COUNT(*)::integer
FROM "contract_reviews"
GROUP BY "created_at"::date, "lang";
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "created_at"::date, 'referrals_shown', 'all', COUNT(*)::integer
FROM "referrals"
GROUP BY "created_at"::date;
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT COALESCE("confirmed_at", "created_at")::date, 'confirmed_referrals', 'all', COUNT(*)::integer
FROM "referrals"
WHERE "confirmed_by_ngo"
GROUP BY COALESCE("confirmed_at", "created_at")::date;
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "created_at"::date, 'feedback_count', 'all', COUNT(*)::integer
FROM "feedback"
WHERE "message_id" IS NOT NULL AND "conversation_id" IS NOT NULL
GROUP BY "created_at"::date;
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "created_at"::date, 'feedback_satisfied', 'all', COUNT(*)::integer
FROM "feedback"
WHERE "rating" >= 4 AND "message_id" IS NOT NULL AND "conversation_id" IS NOT NULL
GROUP BY "created_at"::date;
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT "created_at"::date, 'feedback_rating_sum', 'all', SUM("rating")::integer
FROM "feedback"
WHERE "message_id" IS NOT NULL AND "conversation_id" IS NOT NULL
GROUP BY "created_at"::date;
INSERT INTO "daily_metrics" ("day", "metric", "locale", "value")
SELECT m."created_at"::date, 'llm_tokens', c."lang", SUM(m."tokens")::integer
FROM "messages" AS m
JOIN "conversations" AS c ON c."id" = m."conversation_id"
WHERE m."tokens" IS NOT NULL
GROUP BY m."created_at"::date, c."lang";
--> statement-breakpoint
DELETE FROM "feedback" WHERE "conversation_id" IS NULL OR "message_id" IS NULL;
DELETE FROM "referrals" WHERE "conversation_id" IS NULL;
ALTER TABLE "feedback" ALTER COLUMN "conversation_id" SET NOT NULL;
ALTER TABLE "feedback" ALTER COLUMN "message_id" SET NOT NULL;
ALTER TABLE "referrals" ALTER COLUMN "conversation_id" SET NOT NULL;
ALTER TABLE "referrals" ALTER COLUMN "handoff_code_hash" SET NOT NULL;
ALTER TABLE "referrals" ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "daily_metrics_metric_day_idx" ON "daily_metrics" USING btree ("metric","day");
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");
CREATE INDEX "conversations_last_activity_idx" ON "conversations" USING btree ("last_activity_at");
CREATE UNIQUE INDEX "feedback_message_uidx" ON "feedback" USING btree ("message_id");
CREATE UNIQUE INDEX "referrals_handoff_code_hash_uidx" ON "referrals" USING btree ("handoff_code_hash");
CREATE INDEX "referrals_created_at_idx" ON "referrals" USING btree ("created_at");
CREATE INDEX "referrals_expires_at_idx" ON "referrals" USING btree ("expires_at");
--> statement-breakpoint
-- RLS is default-deny and grants are revoked as a second boundary. Default
-- privileges prevent a future migration-created table from silently escaping.
REVOKE ALL PRIVILEGES ON TABLE public."daily_metrics" FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
DO $$
DECLARE target_role name;
BEGIN
	FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::name[] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
			EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', 'daily_metrics', target_role);
			EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', target_role);
		END IF;
	END LOOP;
END $$;
--> statement-breakpoint
-- Audit entries are append-only for application code. Database owners retain
-- normal break-glass control by disabling/dropping the trigger explicitly.
CREATE FUNCTION public.prevent_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON public."audit_log"
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();
