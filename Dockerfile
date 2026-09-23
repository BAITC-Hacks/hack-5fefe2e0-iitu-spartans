# Образ приложения Voice Router: Next.js + запускатель миграций.
#
# Порядок слоёв рассчитан на кэш: сначала копируются только манифесты и lock-файл, и зависимости
# ставятся отдельным слоем. Изменение кода не пересобирает зависимости; изменение одной зависимости
# докачивает только её — хранилище pnpm вынесено в кэш сборки (--mount=type=cache).

FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM deps AS app
COPY . .
RUN pnpm --filter @voice-router/web build
ENV NODE_ENV=production
EXPOSE 3000
# Сначала миграции (идемпотентно, под advisory-блокировкой), затем сервер приложения.
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @voice-router/web start"]
