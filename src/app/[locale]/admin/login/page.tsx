const ERRORS: Record<string, string> = {
  invalid_credentials: "Invalid email or password, or this account is not an admin.",
  too_many_attempts: "Too many sign-in attempts. Please wait 15 minutes and try again.",
  not_configured: "Admin authentication has not been configured for this deployment.",
};

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">MigraAid admin</h1>
      <p className="text-sm text-neutral-500">
        Sign in with your partner-organisation account.
      </p>
      {error && ERRORS[error] && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {ERRORS[error]}
        </p>
      )}
      <form action="/api/admin/login" method="post" className="flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input required type="email" name="email" autoComplete="username" className="rounded-lg border px-3 py-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input required type="password" name="password" autoComplete="current-password" className="rounded-lg border px-3 py-3" />
        </label>
        <button className="rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
