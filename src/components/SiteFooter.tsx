import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Site footer.
 *
 * The non-affiliation line is the important part. MigraAid names MOM, TADM and
 * partner organisations, cites their published guidance, and hands out referral
 * codes — a worker could very reasonably conclude it is an official channel. It
 * is not, and saying so plainly on every page costs one translated paragraph.
 *
 * The rest is the disclosure surface an independent project needs in place of
 * institutional legitimacy: who runs it, how to reach them, where the source
 * is, and links to what the product does with a worker's data.
 */
export function SiteFooter() {
  const t = useTranslations("footer");

  return (
    <footer className="mt-auto border-t border-hairline bg-sand px-5 py-8 md:px-12">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 text-[13.5px] leading-[1.55] text-muted">
        <p className="font-semibold text-ink">{t("independence")}</p>
        <p>{t("nature")}</p>

        <nav aria-label={t("label")} className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="min-h-11 items-center inline-flex underline underline-offset-4">
            {t("privacy")}
          </Link>
          <Link href="/terms" className="min-h-11 items-center inline-flex underline underline-offset-4">
            {t("terms")}
          </Link>
          <Link href="/emergency" className="min-h-11 items-center inline-flex underline underline-offset-4">
            {t("emergency")}
          </Link>
          <a
            href="https://github.com/eugenewong22/MigraAid"
            className="min-h-11 items-center inline-flex underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            {/* English project name inside a non-English page. */}
            <span lang="en">{t("source")}</span>
          </a>
        </nav>
      </div>
    </footer>
  );
}
