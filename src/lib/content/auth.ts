/**
 * Supabase-backed admin authentication and role checks.
 *
 * Worker routes remain anonymous. Admin access tokens live only in an HttpOnly
 * cookie and are verified with Supabase on every protected request/action.
 * Roles must be assigned in `app_metadata.role`; user metadata is intentionally
 * ignored because users can edit it themselves.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE = "migraaid_admin_token";

export type AdminRole = "author" | "reviewer" | "admin";

export interface AdminPrincipal {
  id: string;
  email: string | null;
  role: AdminRole;
}

interface SupabaseUser {
  id?: unknown;
  email?: unknown;
  app_metadata?: { role?: unknown } | null;
}

const ROLE_LEVEL: Record<AdminRole, number> = {
  author: 1,
  reviewer: 2,
  admin: 3,
};

export function isInsecureDevAdminBypassEnabled(
  env: {
    NODE_ENV?: string;
    ALLOW_INSECURE_DEV_ADMIN?: string;
  } = process.env,
): boolean {
  return (
    env.NODE_ENV !== "production" && env.ALLOW_INSECURE_DEV_ADMIN === "true"
  );
}

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 503,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export function adminPrincipalFromUser(user: SupabaseUser): AdminPrincipal | null {
  const role = user.app_metadata?.role;
  if (
    typeof user.id !== "string" ||
    (role !== "author" && role !== "reviewer" && role !== "admin")
  ) {
    return null;
  }
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : null,
    role,
  };
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

async function verifyToken(token: string): Promise<AdminPrincipal> {
  const cfg = config();
  if (!cfg) {
    throw new AdminAuthError("Admin authentication is not configured.", 503);
  }

  const response = await authFetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status >= 500) {
    throw new AdminAuthError("Admin authentication is unavailable.", 503);
  }
  if (!response.ok) throw new AdminAuthError("Admin sign-in is required.", 401);

  const principal = adminPrincipalFromUser((await response.json()) as SupabaseUser);
  if (!principal) {
    throw new AdminAuthError("This account does not have an admin role.", 403);
  }
  return principal;
}

async function authFetch(input: string, init: RequestInit) {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AdminAuthError("Admin authentication is unavailable.", 503);
  }
}

/** Exchange an email/password for a verified admin access token. */
export async function signInAdmin(email: string, password: string) {
  const cfg = config();
  if (!cfg) {
    throw new AdminAuthError("Admin authentication is not configured.", 503);
  }
  const response = await authFetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (response.status >= 500) {
    throw new AdminAuthError("Admin authentication is unavailable.", 503);
  }
  if (!response.ok) throw new AdminAuthError("Invalid email or password.", 401);

  const session = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
    user?: SupabaseUser;
  };
  const principal = session.user ? adminPrincipalFromUser(session.user) : null;
  if (!principal || typeof session.access_token !== "string") {
    throw new AdminAuthError("This account does not have an admin role.", 403);
  }
  return {
    principal,
    accessToken: session.access_token,
    expiresIn:
      typeof session.expires_in === "number" ? session.expires_in : 60 * 60,
  };
}

/** Fail-closed guard used by both pages and server actions. */
export async function requireAdmin(
  minimumRole: AdminRole = "author",
): Promise<AdminPrincipal> {
  // The auth bypass is opt-in for local-only UI work. Production ignores the
  // flag and fails closed even when its Supabase configuration is incomplete.
  if (!config() && isInsecureDevAdminBypassEnabled()) {
    return { id: "development", email: null, role: "admin" };
  }

  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) throw new AdminAuthError("Admin sign-in is required.", 401);
  const principal = await verifyToken(token);
  if (ROLE_LEVEL[principal.role] < ROLE_LEVEL[minimumRole]) {
    throw new AdminAuthError("A reviewer role is required for this action.", 403);
  }
  return principal;
}

/** Page-friendly guard: expired/missing sessions go to the localized login. */
export async function requireAdminPage(
  locale: string,
  minimumRole: AdminRole = "author",
): Promise<AdminPrincipal> {
  try {
    return await requireAdmin(minimumRole);
  } catch (error) {
    if (error instanceof AdminAuthError && error.status === 401) {
      redirect(`/${locale}/admin/login`);
    }
    throw error;
  }
}
