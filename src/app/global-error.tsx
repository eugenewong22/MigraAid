"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
// global-error replaces the entire document, and only the locale layout
// imports the stylesheet — without this import the crash page renders as
// unstyled browser defaults, exactly when reassurance matters most.
import "./globals.css";

const COPY = {
  en: ["Something went wrong", "Your information has not been submitted. Please try again.", "Try again"],
  bn: ["কিছু ভুল হয়েছে", "আপনার তথ্য জমা দেওয়া হয়নি। আবার চেষ্টা করুন।", "আবার চেষ্টা করুন"],
  ta: ["ஏதோ தவறு ஏற்பட்டது", "உங்கள் தகவல் சமர்ப்பிக்கப்படவில்லை. மீண்டும் முயற்சிக்கவும்.", "மீண்டும் முயற்சிக்கவும்"],
  tl: ["May nangyaring mali", "Hindi naisumite ang iyong impormasyon. Subukan muli.", "Subukan muli"],
  zh: ["出现错误", "您的信息尚未提交。请重试。", "重试"],
  id: ["Terjadi kesalahan", "Informasi Anda belum dikirim. Silakan coba lagi.", "Coba lagi"],
  th: ["เกิดข้อผิดพลาด", "ยังไม่ได้ส่งข้อมูลของคุณ โปรดลองอีกครั้ง", "ลองอีกครั้ง"],
  my: ["တစ်စုံတစ်ခု မှားယွင်းသွားပါသည်", "သင့်အချက်အလက်ကို မပို့ရသေးပါ။ ထပ်မံကြိုးစားပါ။", "ထပ်မံကြိုးစားပါ"],
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<keyof typeof COPY>("en");
  useEffect(() => {
    Sentry.captureException(error);
    const timer = window.setTimeout(() => {
      const pathLocale = window.location.pathname.split("/")[1];
      const candidate = pathLocale || navigator.language.split("-")[0];
      if (candidate in COPY) setLocale(candidate as keyof typeof COPY);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [error]);
  const [title, body, retry] = COPY[locale];

  return (
    <html lang={locale}>
      <head>
        <title>{title}</title>
      </head>
      <body className="flex min-h-screen items-center justify-center p-6">
        <main className="max-w-sm text-center">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-3 text-body-soft">
            {body}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 inline-flex min-h-[52px] items-center justify-center rounded-full bg-terracotta px-8 font-semibold text-[#fff7ec] transition-colors hover:bg-terracotta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            {retry}
          </button>
        </main>
      </body>
    </html>
  );
}
