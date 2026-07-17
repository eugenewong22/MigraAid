"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

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
      <body className="flex min-h-screen items-center justify-center p-6">
        <main className="max-w-sm text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-3 text-neutral-600">
            {body}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white"
          >
            {retry}
          </button>
        </main>
      </body>
    </html>
  );
}
