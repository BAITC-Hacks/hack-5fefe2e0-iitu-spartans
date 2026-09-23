"use client";

import { useI18n } from "../lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function AppHeader() {
  const { t } = useI18n();
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-brand">
          <span className="app-brand__mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
              <path d="M5 13v6M11 7v18M17 3v26M23 9v14M29 13v6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="app-header__title">{t("app.title")}</h1>
            <p className="app-header__subtitle">{t("app.subtitle")}</p>
          </div>
        </div>
        <div className="app-header__tools">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
