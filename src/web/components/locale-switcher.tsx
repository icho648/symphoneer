"use client";

import { type Dictionary, isLocale, type Locale, locales } from "../i18n/index.ts";

export function LocaleSwitcher({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const changeLocale = (nextLocale: string) => {
    if (!isLocale(nextLocale)) return;
    window.location.assign(`/${nextLocale}`);
  };

  return (
    <label className="flex items-center border border-line bg-panel/70 px-2 text-[10px] text-muted">
      <span className="sr-only">{dictionary.controls.language}</span>
      <select
        aria-label={dictionary.controls.language}
        className="cursor-pointer bg-transparent py-2 outline-none"
        onChange={(event) => changeLocale(event.currentTarget.value)}
        value={locale}
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {dictionary.localeNames[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
