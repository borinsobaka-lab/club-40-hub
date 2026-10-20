/**
 * Настройки очереди. Хранятся в amoCRM — в скрытом поле виджета типа custom
 * (`rr_config`, JSON). Сервер читает их через API, своей копии не держит:
 * сохранили в окне виджета — со следующей сделки работает по-новому.
 */
export const SETTINGS_FIELD = "rr_config";

export interface QueueSettings {
  /** id пользователей amoCRM в порядке очереди. */
  users: number[];
  /** Сделки, которые сотрудник завёл вручную, не перераспределять. */
  skipManual: boolean;
}

export const EMPTY_SETTINGS: QueueSettings = { users: [], skipManual: false };

export function parseSettings(raw: unknown): QueueSettings {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return EMPTY_SETTINGS;
    }
  }
  if (!v || typeof v !== "object") return EMPTY_SETTINGS;
  const o = v as { users?: unknown; skip_manual?: unknown };
  const users: number[] = [];
  for (const u of Array.isArray(o.users) ? o.users : []) {
    const id = Number(u);
    if (Number.isInteger(id) && id > 0 && !users.includes(id)) users.push(id);
  }
  return { users, skipManual: o.skip_manual === true || o.skip_manual === "Y" };
}
