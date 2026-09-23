"use client";

import type { RouteDecision } from "@voice-router/core";
import { useI18n } from "../lib/i18n";

type SlotValue = RouteDecision["slots"][string];

function formatSlot(value: SlotValue): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function SlotsTable({ slots }: { slots: RouteDecision["slots"] }) {
  const { t } = useI18n();
  const entries = Object.entries(slots);
  if (entries.length === 0) return <p className="muted">{t("trace.noSlots")}</p>;
  return (
    <table className="table">
      <tbody>
        {entries.map(([name, value]) => (
          <tr key={name}>
            <th scope="row">
              <code>{name}</code>
            </th>
            <td>{formatSlot(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
