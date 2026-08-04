import type { Locale } from "./locales.ts";
import { enUS } from "./messages/en-US.ts";
import { zhCN } from "./messages/zh-CN.ts";

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends readonly unknown[]
      ? T
      : T extends object
        ? { [Key in keyof T]: Widen<T[Key]> }
        : T;

export type Dictionary = Widen<typeof enUS>;

const dictionaries: Record<Locale, Dictionary> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export type { Locale } from "./locales.ts";
export { defaultLocale, detectLocale, isLocale, localeCookieName, locales } from "./locales.ts";

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
