/**
 * Разбор вебхука amoCRM. Приходит application/x-www-form-urlencoded с
 * вложенными ключами: leads[add][0][id]=…, leads[status][0][old_status_id]=…,
 * account[id]=…, account[subdomain]=…
 */
export interface LeadEvent {
  id: number;
  responsibleUserId: number;
  createdUserId: number;
  statusId: number;
  /** Только у смены этапа (leads[status]). */
  oldStatusId: number;
}

export interface WebhookPayload {
  accountId: number | null;
  /** Новые сделки (событие add_lead). */
  added: LeadEvent[];
  /** Смена этапа (status_lead) — нужна, чтобы поймать принятие из «Неразобранного». */
  statusChanged: LeadEvent[];
}

const num = (v: string | undefined | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseWebhook(body: string): WebhookPayload {
  const params = new URLSearchParams(body);
  const groups = { add: new Map<string, Record<string, string>>(), status: new Map() };
  for (const [key, value] of params) {
    const m = /^leads\[(add|status)\]\[(\d+)\]\[([a-z_]+)\]$/.exec(key);
    if (!m) continue;
    const map = groups[m[1] as "add" | "status"];
    const lead = map.get(m[2]) ?? {};
    lead[m[3]] = value;
    map.set(m[2], lead);
  }
  const toEvents = (map: Map<string, Record<string, string>>) =>
    [...map.values()]
      .map((l) => ({
        id: num(l.id),
        responsibleUserId: num(l.responsible_user_id),
        createdUserId: num(l.created_user_id),
        statusId: num(l.status_id),
        oldStatusId: num(l.old_status_id),
      }))
      .filter((l) => l.id > 0);
  return {
    accountId: params.has("account[id]") ? num(params.get("account[id]")) : null,
    added: toEvents(groups.add),
    statusChanged: toEvents(groups.status),
  };
}
