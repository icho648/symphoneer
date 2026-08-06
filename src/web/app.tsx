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

function LocaleBoard() {
  const { locale: raw } = useParams();
  if (!isLocale(raw)) return <Navigate replace to={`/${defaultLocale}`} />;
  const locale: Locale = raw;
  document.documentElement.lang = locale;
  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=31536000`;
  return (
    <main className="box-border h-screen overflow-hidden">
      <TaskBoard dictionary={getDictionary(locale)} locale={locale} />
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
