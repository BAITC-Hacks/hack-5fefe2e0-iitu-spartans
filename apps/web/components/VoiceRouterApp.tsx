"use client";

import { useI18n } from "../lib/i18n";
import { AppHeader } from "./AppHeader";

/** Экран демо: слева разговор с роботом, справа панель супервизора по последнему ходу. */
export function VoiceRouterApp() {
  const { t } = useI18n();
  return (
    <>
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="conversation-title">
          <div className="card__header">
            <h2 id="conversation-title" className="card__title">
              {t("conv.title")}
            </h2>
          </div>
          <p className="muted">{t("conv.empty")}</p>
        </section>
        <aside className="card" aria-labelledby="trace-title">
          <div className="card__header">
            <h2 id="trace-title" className="card__title">
              {t("trace.title")}
            </h2>
          </div>
          <p className="muted">{t("trace.empty")}</p>
        </aside>
      </main>
    </>
  );
}
