import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { getDictionary, isLocale, locales } from "../../i18n/index.ts";

import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dictionary = getDictionary(isLocale(locale) ? locale : "zh-CN");

  return {
    title: {
      default: "Symphoneer",
      template: "%s · Symphoneer",
    },
    description: dictionary.metadata.description,
    icons: {
      icon: [{ url: "/brand/symphoneer-icon.png", type: "image/png" }],
      apple: [{ url: "/brand/symphoneer-icon.png" }],
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
