"use client";

import { VoiceRouterApp } from "../components/VoiceRouterApp";
import { I18nProvider } from "../lib/i18n";

// Страница целиком клиентская: микрофон, синтез речи и состояние диалога живут только в браузере.
export default function HomePage() {
  return (
    <I18nProvider>
      <VoiceRouterApp />
    </I18nProvider>
  );
}
