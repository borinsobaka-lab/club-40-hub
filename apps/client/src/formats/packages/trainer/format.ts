import type { Translator } from "@/i18n";
import { GOAL_LABEL } from "./profile-labels";

/** Подписи экранов тренера без запросов к базе — их проверяют тесты. */

/** «сегодня 14:05», «вчера 09:30», «12 окт.» — когда оставлен комментарий. */
export function commentWhen(iso: string, t: Translator, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return t("сегодня {time}", { time: t.time(d) });
  if (days === 1) return t("вчера {time}", { time: t.time(d) });
  return t.date(d, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Главная цель клиента одной строкой («Другое» — с текстом клиента). */
export function goalText(goal: string | null, other: string | null, t: Translator) {
  if (!goal) return null;
  const label = GOAL_LABEL[goal] ? t(GOAL_LABEL[goal]) : goal;
  return goal === "other" && other?.trim() ? `${label}: ${other.trim()}` : label;
}

/** Имя клиента: «Имя Фамилия». */
export function clientDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
}) {
  const parts = [c.first_name, c.last_name].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : c.full_name?.trim() || "—";
}
