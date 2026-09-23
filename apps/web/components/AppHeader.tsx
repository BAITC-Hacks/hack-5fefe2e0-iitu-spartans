"use client";

import { useI18n } from "../lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function AppHeader() {
  const { t } = useI18n();
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div>
          <h1 className="app-header__title">{t("app.title")}</h1>
          <p className="app-header__subtitle">{t("app.subtitle")}</p>
        </div>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
