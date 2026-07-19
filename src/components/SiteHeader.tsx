import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

type NavKey = "chat" | "contract" | "emergency";

/**
 * Light "Daybreak" header shared across screens: sits on cream with a hairline
 * bottom border. Terracotta circle-with-flat-bottom logo + wordmark (links
 * home), the Ask / My contract / Emergency nav with a terracotta active
 * underline, and the language pill.
 *
 * On mobile the wordmark swaps to the current page's name (`mobileTitle`);
 * Emergency's title is shown in emergency red.
 */
export async function SiteHeader({
  active,
  mobileTitle,
}: {
  active?: NavKey;
  mobileTitle?: string;
}) {
  const t = await getTranslations("nav");

  const items: {
    key: NavKey;
    href: "/chat" | "/contract" | "/emergency";
    label: string;
  }[] = [
    { key: "chat", href: "/chat", label: t("ask") },
    { key: "contract", href: "/contract", label: t("contract") },
    { key: "emergency", href: "/emergency", label: t("emergency") },
  ];

  function linkClass(item: (typeof items)[number]) {
    const isActive = item.key === active;
    const isEmergency = item.key === "emergency";
    const base =
      "inline-flex min-h-11 items-center py-3 text-[16px] leading-none no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream";
    if (isEmergency) {
      // Emergency is always emergency red; active gains the red underline.
      return `${base} font-[600] text-emergency ${
        isActive ? "border-b-[3px] border-emergency" : ""
      }`;
    }
    return isActive
      ? `${base} font-[600] text-ink border-b-[3px] border-terracotta`
      : `${base} font-[500] text-body-soft hover:text-ink`;
  }

  return (
    <header className="border-b border-hairline px-5 md:px-12">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3.5 md:py-5">
        <div className="flex items-center gap-2.5 md:gap-[11px]">
          {/* The home link is only ever the logo + "MigraAid" wordmark. The
              mobile page title lives OUTSIDE it: a page title that secretly
              navigates home is a trap (tapping the red "Emergency" heading
              must not leave the emergency numbers), and it would give the
              link an ambiguous accessible name shared with the nav link. */}
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream md:gap-[11px]"
          >
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[50%_50%_0_0] bg-terracotta font-display text-[15px] font-extrabold text-cream md:h-9 md:w-9 md:text-[17px]"
            >
              M
            </span>
            {/* When a mobile page title is shown, the wordmark collapses to
                sr-only on mobile so the link keeps its "MigraAid" name. */}
            <span
              className={`font-display text-[21px] font-bold leading-none text-ink ${
                mobileTitle ? "sr-only sm:not-sr-only" : ""
              }`}
            >
              MigraAid
            </span>
          </Link>
          {mobileTitle && (
            <span
              className={`font-display text-[18px] font-bold leading-none sm:hidden ${
                active === "emergency" ? "text-emergency" : "text-ink"
              }`}
            >
              {mobileTitle}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:gap-x-7">
          <nav
            aria-label={t("primary")}
            className="flex items-center gap-x-5 gap-y-1 md:gap-x-7"
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
