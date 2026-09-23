"use client";

import { UI_LOCALES, useI18n, type MessageKey } from "../lib/i18n";

/** Переключатель языка подписей интерфейса; на язык разговора с роботом не влияет. */
export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="locale-switch" role="group" aria-label={t("app.uiLanguage")}>
      {UI_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          className="locale-switch__button"
          aria-pressed={locale === code}
          lang={code}
          onClick={() => setLocale(code)}
        >
          {t(`locale.${code}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
