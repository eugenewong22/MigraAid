import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

type NavKey = "chat" | "contract" | "emergency";

/**
 * Navy institutional header shared across screens: sky-disc wordmark (links
 * home), an optional current-page breadcrumb, the Ask / My contract / Emergency
 * nav with an active underline, and the language pill.
 *
 * `embedded` renders it transparently inside the home hero's navy block (with a
 * hairline underneath); otherwise it is a standalone navy bar.
 */
export async function SiteHeader({
  active,
  breadcrumb,
  embedded = false,
}: {
  active?: NavKey;
  breadcrumb?: string;
  embedded?: boolean;
}) {
  const t = await getTranslations("nav");

  const items: { key: NavKey; href: "/chat" | "/contract" | "/emergency"; label: string }[] = [
    { key: "chat", href: "/chat", label: t("ask") },
    { key: "contract", href: "/contract", label: t("contract") },
    { key: "emergency", href: "/emergency", label: t("emergency") },
  ];

  function linkClass(item: (typeof items)[number]) {
    const isActive = item.key === active;
    const isEmergency = item.key === "emergency";
    const base =
      "inline-flex min-h-11 items-center text-[15.5px] no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-navy";
    if (isEmergency) {
      // Emergency stays accent-coloured; active gains the accent underline.
      return `${base} font-[650] text-emergency-accent hover:text-white ${
        isActive ? "border-b-2 border-emergency-accent" : ""
      }`;
    }
    return isActive
      ? `${base} font-[650] text-white border-b-2 border-sky`
      : `${base} text-sky-faint hover:text-white`;
  }

  return (
    <header className={embedded ? "" : "bg-navy px-6 md:px-12"}>
      <div
        className={
          "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 " +
          (embedded
            ? "border-b border-white/[0.14] py-[18px]"
            : "py-3 md:py-[14px]")
        }
      >
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            <span
              aria-hidden="true"
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-sky text-[16px] font-extrabold text-navy"
            >
              M
            </span>
            <span className="text-[20px] font-bold leading-none text-white">
              MigraAid
            </span>
          </Link>
          {breadcrumb && (
            <span className="hidden text-[15px] text-sky-muted sm:inline">
              / {breadcrumb}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:gap-x-7">
          <nav
            aria-label={t("primary")}
            className="flex items-center gap-x-5 gap-y-2 md:gap-x-7"
          >
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.key === active ? "page" : undefined}
                className={linkClass(item)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
