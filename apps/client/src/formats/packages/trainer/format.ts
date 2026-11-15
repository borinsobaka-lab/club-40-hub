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

/**
 * Ссылка на Telegram сотрудника из поля «Telegram» админки: ник (с «@» или
 * без), «t.me/ник» или ссылка целиком. Чужие адреса и мусор — null (кнопки нет).
 */
export function telegramHref(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const link = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(.+)$/i);
  if (link) return `https://t.me/${link[1]}`;
  const nick = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,32}$/.test(nick) ? `https://t.me/${nick}` : null;
}
