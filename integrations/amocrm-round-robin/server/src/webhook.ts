/**
 * Разбор вебхука amoCRM. Приходит application/x-www-form-urlencoded с
 * вложенными ключами: leads[add][0][id]=…, leads[add][0][responsible_user_id]=…,
 * account[id]=…, account[subdomain]=…
 */
export interface NewLead {
  id: number;
  responsibleUserId: number;
  createdUserId: number;
  pipelineId: number;
  statusId: number;
}

export interface WebhookPayload {
  accountId: number | null;
  subdomain: string | null;
  leads: NewLead[];
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseWebhook(body: string): WebhookPayload {
  const params = new URLSearchParams(body);
  const leads = new Map<string, Record<string, string>>();
  for (const [key, value] of params) {
    const m = /^leads\[add\]\[(\d+)\]\[([a-z_]+)\]$/.exec(key);
    if (!m) continue;
    const lead = leads.get(m[1]) ?? {};
    lead[m[2]] = value;
    leads.set(m[1], lead);
  }
  return {
    accountId: params.has("account[id]") ? num(params.get("account[id]")!) : null,
    subdomain: params.get("account[subdomain]"),
    leads: [...leads.values()]
      .map((l) => ({
        id: num(l.id),
        responsibleUserId: num(l.responsible_user_id),
        createdUserId: num(l.created_user_id),
        pipelineId: num(l.pipeline_id),
        statusId: num(l.status_id),
      }))
      .filter((l) => l.id > 0),
  };
}
