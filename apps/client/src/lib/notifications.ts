import { useSyncExternalStore } from "react";

import { CLUB, SCHEDULE_TITLE } from "@/lib/terms";

/**
 * Уведомления приложения. Пока демонстрационные (рассылки из админки ещё
 * нет): список ниже, отметки «прочитано» — в браузере (localStorage). Общие
 * для страницы «Уведомления» и счётчика на колокольчике главной.
 */
export type Notification = {
  id: string;
  title: string;
  body: string;
  receivedAt: string; // ISO
  read: boolean;
  link?: string;
};

const MOCK: Notification[] = [
  {
    id: "1",
    title: "🎉 Добро пожаловать в Base40!",
    body: `Привет! Мы рады видеть тебя в ${CLUB.prep}.\nЗагляни в раздел «${SCHEDULE_TITLE}» — там уже доступно расписание на ближайшие дни.`,
    receivedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    read: false,
  },
  {
    id: "2",
    title: "🔥 Новая тренировка в расписании",
    body: "В среду в 19:00 — функциональная тренировка с Анной.\nОсталось 4 места, успей записаться!",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    read: false,
  },
  {
    id: "5",
    title: "🎁 Партнёрская акция",
    body: "Скидка 20% на спортивное питание для участников Base40.\nПодробности и промокод — на сайте партнёра.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    read: false,
    link: "https://example.com/promo",
  },
  {
    id: "3",
    title: "💳 Абонемент скоро закончится",
    body: "Осталось 3 занятия по текущему абонементу.\nПродли его в разделе «Абонементы», чтобы не прерывать тренировки.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    read: true,
  },
  {
    id: "6",
    title: "📺 Новое видео на YouTube",
    body: `Разбор техники приседаний от тренера ${CLUB.gen}.\nСмотрите по ссылке ниже.`,
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    read: true,
    link: "https://youtube.com",
  },
  {
    id: "4",
    title: `📣 Новость ${CLUB.gen}`,
    body: "В эти выходные — открытая тренировка на свежем воздухе.\nПодробности в разделе новостей на главной.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    read: true,
  },
];

const STORAGE_KEY = "base40.notificationsRead";
const listeners = new Set<() => void>();
let readIds: Set<string> | null = null;
let snapshot: Notification[] | null = null;

function loadRead(): Set<string> {
  if (readIds) return readIds;
  readIds = new Set(MOCK.filter((n) => n.read).map((n) => n.id));
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    if (raw) for (const id of JSON.parse(raw) as string[]) readIds.add(id);
  } catch {
    // нет доступа к хранилищу — отметки живут до перезагрузки
  }
  return readIds;
}

function getSnapshot(): Notification[] {
  if (!snapshot) {
    const read = loadRead();
    snapshot = MOCK.map((n) => ({ ...n, read: read.has(n.id) }));
  }
  return snapshot;
}

const SERVER_SNAPSHOT = MOCK;

function update(ids: string[]) {
  const read = loadRead();
  ids.forEach((id) => read.add(id));
  snapshot = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...read]));
  } catch {
    // см. loadRead
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotifications() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  return {
    items,
    unread: items.filter((n) => !n.read).length,
    markRead: (id: string) => update([id]),
    markAllRead: () => update(items.map((n) => n.id)),
  };
}
