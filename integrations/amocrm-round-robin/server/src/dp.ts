/**
 * Событие цифровой воронки: в настройках воронки на этапе стоит триггер
 * «Очередь ответственных», условие сработало — amoCRM шлёт POST на
 * dp.webhook_url из manifest.json. Content-Type документация не называет,
 * поэтому принимаем и JSON, и application/x-www-form-urlencoded с
 * вложенными ключами (event[data][id]=…). Поля по документации:
 * event.type / event.type_code, event.data.id (сделка),
 * event.data.element_type (2 — сделка), event.data.status_id,
 * event.data.pipeline_id, account_id, subdomain.
 */
export interface DpEvent {
  accountId: number;
  subdomain: string;
  type: string;
  elementType: number;
  leadId: number;
  statusId: number;
  pipelineId: number;
}

/** Тип элемента «сделка» в событиях amoCRM. */
export const ELEMENT_LEAD = 2;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** a[b][c]=1 → { a: { b: { c: "1" } } } */
export function parseNestedForm(body: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const parts = key.replace(/\]/g, "").split("[");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (!next || typeof next !== "object") node[parts[i]] = {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return root;
}

/** null — тело не разобрать. */
export function parseDpEvent(body: string, contentType: string): DpEvent | null {
  let raw: unknown = null;
  const text = body.trim();
  if (contentType.includes("json") || text.startsWith("{")) {
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  } else {
    raw = parseNestedForm(text);
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  const event = (o.event ?? {}) as Record<string, any>;
  const data = (event.data ?? {}) as Record<string, any>;
  return {
    accountId: num(o.account_id ?? o.account?.id),
    subdomain: String(o.subdomain ?? o.account?.subdomain ?? ""),
    type: String(event.type_code ?? event.type ?? ""),
    elementType: num(data.element_type),
    leadId: num(data.id),
    statusId: num(data.status_id),
    pipelineId: num(data.pipeline_id),
  };
}
