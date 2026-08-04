import type { Locale } from "@symphoneer/i18n";

export function formatDateTime(timestamp: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
