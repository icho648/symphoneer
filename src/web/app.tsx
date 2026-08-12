import { useEffect, useLayoutEffect } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { TaskBoard } from "./components/task-board/index.tsx";
import {
  defaultLocale,
  detectLocale,
  getDictionary,
  isLocale,
  type Locale,
  localeCookieName,
} from "./i18n/index.ts";
import { useRuntimeClient } from "./runtime-provider.tsx";
import { configureWorkbench, connectWorkbench } from "./stores/workbench.ts";

function LocaleBoard() {
  const { locale: raw } = useParams();
  if (!isLocale(raw)) return <Navigate replace to={`/${defaultLocale}`} />;
  return <LocalizedBoard locale={raw} />;
}

function LocalizedBoard({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const runtime = useRuntimeClient();
  useLayoutEffect(() => configureWorkbench(dictionary, locale), [dictionary, locale]);
  useEffect(() => connectWorkbench(runtime), [runtime]);
  document.documentElement.lang = locale;
  // biome-ignore lint/suspicious/noDocumentCookie: locale preference is a simple first-party cookie
  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=31536000`;
  return (
    <main className="box-border h-screen overflow-hidden">
      <TaskBoard />
    </main>
  );
}

export function App() {
  const detected =
    typeof document === "undefined"
      ? defaultLocale
      : detectLocale(
          document.cookie
            .split("; ")
            .find((part) => part.startsWith(`${localeCookieName}=`))
            ?.split("=")[1],
          navigator.language,
        );

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={`/${detected}`} />} />
      <Route path="/:locale/*" element={<LocaleBoard />} />
    </Routes>
  );
}
