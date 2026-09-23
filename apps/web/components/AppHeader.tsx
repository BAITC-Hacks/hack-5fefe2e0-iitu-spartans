"use client";

import { useI18n } from "../lib/i18n";
import { AudioLines } from "lucide-react";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function AppHeader() {
  const { t } = useI18n();
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-brand">
          <span className="app-brand__mark" aria-hidden="true">
            <AudioLines size={28} strokeWidth={1.8} />
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
