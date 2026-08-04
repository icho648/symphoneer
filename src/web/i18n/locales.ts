export const locales = ["zh-CN", "en-US"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";
export const localeCookieName = "symphoneer-locale";

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}

export function detectLocale(
  cookieLocale: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;

  for (const item of (acceptLanguage ?? "").split(",")) {
    const language = item.trim().split(";", 1)[0]?.toLowerCase();
    if (language?.startsWith("zh")) return "zh-CN";
    if (language?.startsWith("en")) return "en-US";
  }

  return defaultLocale;
}
