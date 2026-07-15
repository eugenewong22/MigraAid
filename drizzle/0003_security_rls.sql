-- MigraAid accesses these tables only through its trusted server-side database
-- connection. Supabase's public PostgREST roles must never read worker data or
-- mutate the reviewed knowledge base directly.
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
-- PostgreSQL's default-deny RLS behavior applies because no public policies are
-- created. Revoking table grants is a second boundary and is conditional so the
-- migration remains portable to non-Supabase Postgres installations.
REVOKE ALL PRIVILEGES ON TABLE
  public."audit_log",
  public."content_chunks",
  public."content_items",
  public."contract_reviews",
  public."conversations",
  public."emergency_contacts",
  public."feedback",
  public."messages",
  public."orgs",
  public."referrals"
FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  target_role name;
  target_table name;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::name[] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      FOREACH target_table IN ARRAY ARRAY[
        'audit_log',
        'content_chunks',
        'content_items',
        'contract_reviews',
        'conversations',
        'emergency_contacts',
        'feedback',
        'messages',
        'orgs',
        'referrals'
      ]::name[] LOOP
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          target_table,
          target_role
        );
      END LOOP;
    END IF;
  END LOOP;
END $$;
