-- 001: журнал ходов диалога для панели супервизора.
-- ТЗ: супервизор видит, какие сценарии выбирались, где робот сомневался и ошибся, и время по этапам.
-- Одна строка — один ход: реплика клиента, решение маршрутизатора, действие политики, ответ, задержка.

CREATE TABLE dialogs (
  dialog_id  uuid        PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE turns (
  turn_id        bigserial   PRIMARY KEY,
  dialog_id      uuid        NOT NULL REFERENCES dialogs (dialog_id) ON DELETE CASCADE,
  turn_no        integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  transcript     text        NOT NULL,
  language       text        NOT NULL CHECK (language IN ('ru', 'kk', 'mixed')),
  source         text        NOT NULL CHECK (source IN ('router-service', 'core-llm', 'demo')),
  action_kind    text        NOT NULL CHECK (action_kind IN ('run', 'clarify', 'continue', 'handoff')),
  -- Выбранный сценарий и уверенность вынесены в столбцы: по ним строится статистика и фильтр истории.
  top_scenario   text,
  top_confidence numeric(4, 3),
  -- Полное решение и задержка хранятся как есть (JSONB) — для показа в панели, не для поиска.
  decision       jsonb,
  reply          text        NOT NULL,
  error          text,
  latency_ms     jsonb       NOT NULL,
  UNIQUE (dialog_id, turn_no)
);

-- Лента последних ходов в панели супервизора.
CREATE INDEX turns_created_at_idx ON turns (created_at DESC);
-- Статистика и разбор ошибок по сценарию.
CREATE INDEX turns_top_scenario_idx ON turns (top_scenario);
