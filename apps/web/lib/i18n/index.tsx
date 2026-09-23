"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "../../messages/en.json";
import kk from "../../messages/kk.json";
import ru from "../../messages/ru.json";

/**
 * Локализация подписей интерфейса без внешних зависимостей.
 *
 * Язык интерфейса не связан с языком разговора: супервизор может читать панель по-английски,
 * а клиент говорить по-казахски. Поэтому здесь только подписи, реплики робота не переводятся.
 */

/** Русский словарь — эталон: его ключи обязательны для остальных языков. */
export type Messages = typeof ru;
export type MessageKey = keyof Messages;

export const UI_LOCALES = ["ru", "kk", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

// Явный тип Messages превращает пропущенный ключ в казахском или английском словаре в ошибку сборки.
const DICTIONARIES: Record<UiLocale, Messages> = { ru, kk, en };

const STORAGE_KEY = "voice-router.ui-locale";
const DEFAULT_LOCALE: UiLocale = "ru";

type Vars = Record<string, string | number>;

interface I18nValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Страница пререндерится на сервере, где localStorage нет: стартуем с языка по умолчанию,
  // а сохранённый выбор читаем после монтирования, чтобы не было расхождения гидратации.
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isUiLocale(saved)) setLocaleState(saved);
    } catch {
      // Приватный режим или запрет хранилища: остаёмся на языке по умолчанию.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Выбор просто не переживёт перезагрузку — это не повод ломать интерфейс.
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dictionary = DICTIONARIES[locale];
    return {
      locale,
      setLocale,
      t: (key, vars) => format(dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key, vars),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n вызван вне I18nProvider");
  return value;
}
