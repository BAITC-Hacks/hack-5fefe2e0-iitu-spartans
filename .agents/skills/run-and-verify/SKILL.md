---
name: run-and-verify
description: Запуск и полная проверка Voice Router — установка, тесты, Docker, проверка хода диалога. Использовать перед каждым pull request и при проверке чистым клоном по README.
---

# Запуск и проверка

1. `corepack enable` — pnpm нужной версии из поля `packageManager`.
2. `pnpm verify` — установка строго по lock-файлу, проверка типов (TypeScript 7), тесты (Vitest 5). Должно быть зелёным.
3. `docker compose up --build` — PostgreSQL 16 и приложение; в логе `web` видно применённые миграции и `Ready`.
4. `curl localhost:3000/api/health` — ожидается `{"ok":true,"db":true,"migrations":N}`.
5. Ход диалога:
   `curl -X POST localhost:3000/api/turn -H "Content-Type: application/json" -d '{"utterance":"Когда будет выплата?","state":{"lowConfidenceStreak":0,"history":[]}}'`
   — ответ робота, `trace` (сценарий, действие, источник, задержка), `state` с `dialogId`.
6. `curl "localhost:3000/api/turns?limit=5"` — ход появился в журнале.
7. Интерфейс: http://localhost:3000 — реплика текстом или голосом, панель трассировки справа.

Без `OPENAI_API_KEY` и `ROUTER_URL` решение принимает демо-режим (`trace.source = "demo"`) — это нормально для проверки
запуска, качество выбора сценария оценивается в режиме с моделью.

Если `pnpm install` падает с `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` — в lock-файле пакет моложе суток; закрепить
предыдущую версию, исключения из политики не добавлять (ARCHITECTURE.md, ADR-013).
