/**
 * Admin access guard.
 *
 * M5 placeholder: real Supabase Auth + role checks (author/reviewer RBAC) drop in
 * here. Until Supabase is configured, admin is open in development but blocked in
 * production, so a deploy can never expose an unauthenticated admin surface.
 */
export async function requireAdmin(): Promise<void> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error(
      "Admin auth is not configured. Set up Supabase Auth before deploying the admin panel.",
    );
  }
  // TODO(M5): verify the Supabase session and require an admin/reviewer role.
}
