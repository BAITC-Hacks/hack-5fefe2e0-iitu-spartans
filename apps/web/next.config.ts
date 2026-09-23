import type { NextConfig } from "next";

const config: NextConfig = {
  // Пакеты рабочего пространства подключаются исходниками TypeScript и транспилируются Next.js.
  transpilePackages: ["@voice-router/core"],
};

export default config;
