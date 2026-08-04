"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "../i18n/index.ts";

import { useTheme } from "./theme-provider";

const options = [
  { value: "light", icon: "☼", label: "light" },
  { value: "dark", icon: "◐", label: "dark" },
  { value: "system", icon: "◌", label: "system" },
] as const;

export function ThemeSwitcher({ labels }: { labels: Dictionary["controls"] }) {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <fieldset className="flex items-center border border-line bg-panel/70 p-0.5">
      <legend className="sr-only">{labels.theme}</legend>
      {options.map(({ icon, label, value }) => (
        <button
          aria-label={labels[label]}
          aria-pressed={mounted && theme === value}
          className={`grid size-7 cursor-pointer place-items-center text-xs transition hover:bg-signal/10 ${mounted && theme === value ? "bg-signal/15 text-signal" : "text-muted"}`}
          key={value}
          onClick={() => setTheme(value)}
          title={labels[label]}
          type="button"
        >
          {icon}
        </button>
      ))}
    </fieldset>
  );
}
