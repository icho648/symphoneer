import { getDictionary, isLocale, type Locale } from "@symphoneer/i18n";
import { notFound } from "next/navigation";

import { TaskBoard } from "@/components/task-board";
import { initialHealth, initialSnapshot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale: Locale = rawLocale;
  const [snapshot, health] = await Promise.all([initialSnapshot(), initialHealth()]);

  return (
    <main className="min-h-screen">
      <TaskBoard
        dictionary={getDictionary(locale)}
        initialHealth={health}
        initialSnapshot={snapshot}
        locale={locale}
      />
    </main>
  );
}
