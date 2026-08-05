import type { Locale } from "../i18n/index.ts";

export function formatDateTime(timestamp: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
