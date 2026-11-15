import { clientName } from "@/lib/format";
import { MEMBERSHIP_KIND_LABEL, type MembershipKind } from "@/lib/payments";
import { effectiveStatus, MEMBERSHIP_STATUS_LABEL } from "@/lib/membership-status";

/**
 * «Экспорт» → «Абонементы клиентов» (решение владельца 2026-11-15): выгрузка
 * абонементов клиентов в Excel, чтобы свести её с выгрузкой прежней учётной
 * системы и найти тех, у кого абонемент там закончился, а здесь нового нет.
 * Здесь — только разбор строк базы в строки файла (без сети и без xlsx),
 * страница — routes/_authenticated/export.tsx, тест — рядом.
 */

export type ExportMembershipRow = {
  id: string;
  studio_id: string;
  status: string | null;
  started_at: string | null;
  ends_at: string | null;
  visits_left: number | null;
  personal_left: number | null;
  diagnostics_left: number | null;
  starts_on_first_visit: boolean | null;
  created_at: string;
  clients: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    phone2: string | null;
  } | null;
  memberships: { name: string | null; kind: string | null } | null;
};

/** Статусы, при которых абонемент у клиента есть: действует, заморожен, ждёт начала. */
const CURRENT = new Set(["active", "awaiting", "frozen", "pending"]);

export function isCurrentMembership(m: ExportMembershipRow, today: string): boolean {
  return CURRENT.has(effectiveStatus(m, today));
}

/** Строка листа «Абонементы»: один абонемент клиента. */
export type MembershipLine = {
  club: string;
  client: string;
  email: string;
  phone: string;
  phone2: string;
  membership: string;
  kind: string;
  status: string;
  current: boolean;
  startedAt: string | null;
  endsAt: string | null;
  visitsLeft: number | null;
  personalLeft: number | null;
  diagnosticsLeft: number | null;
  createdAt: string;
};

const text = (v: string | null | undefined) => (v ?? "").trim();
const emailOf = (v: string | null | undefined) => text(v).toLowerCase();

function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  return MEMBERSHIP_KIND_LABEL[kind as MembershipKind] ?? kind;
}

export function membershipLines(
  rows: ExportMembershipRow[],
  clubName: (studioId: string) => string,
  today: string,
): MembershipLine[] {
  return rows
    .filter((r) => r.clients)
    .map((r) => {
      const status = effectiveStatus(r, today);
      return {
        club: clubName(r.studio_id),
        client: clientName(r.clients!),
        email: emailOf(r.clients!.email),
        phone: text(r.clients!.phone),
        phone2: text(r.clients!.phone2),
        membership: text(r.memberships?.name),
        kind: kindLabel(r.memberships?.kind),
        status: MEMBERSHIP_STATUS_LABEL[status] ?? status,
        current: CURRENT.has(status),
        startedAt: r.started_at ? r.started_at.slice(0, 10) : null,
        endsAt: r.ends_at ? r.ends_at.slice(0, 10) : null,
        visitsLeft: r.visits_left,
        personalLeft: r.personal_left,
        diagnosticsLeft: r.diagnostics_left,
        createdAt: r.created_at.slice(0, 10),
      };
    })
    .sort(
      (a, b) =>
        a.client.localeCompare(b.client, "ru") ||
        (b.endsAt ?? "9999").localeCompare(a.endsAt ?? "9999"),
    );
}

/** Строка листа «Клиенты»: один клиент, есть ли у него абонемент сейчас. */
export type ClientLine = {
  client: string;
  email: string;
  phone: string;
  phone2: string;
  clubs: string;
  hasCurrent: boolean;
  /** Действующие абонементы через «; ». */
  current: string;
  /** Самый поздний срок среди действующих (null — без срока или нет). */
  currentEndsAt: string | null;
  /** Последний закончившийся абонемент и когда закончился. */
  lastEnded: string;
  lastEndedAt: string | null;
  total: number;
};

export function clientLines(
  rows: ExportMembershipRow[],
  clubName: (studioId: string) => string,
  today: string,
): ClientLine[] {
  const byClient = new Map<string, ExportMembershipRow[]>();
  for (const r of rows) {
    if (!r.clients) continue;
    const list = byClient.get(r.clients.id) ?? [];
    list.push(r);
    byClient.set(r.clients.id, list);
  }
  const lines: ClientLine[] = [];
  for (const list of byClient.values()) {
    const c = list[0].clients!;
    const current = list.filter((r) => isCurrentMembership(r, today));
    const ended = list
      .filter((r) => !isCurrentMembership(r, today))
      .sort((a, b) => (b.ends_at ?? b.created_at).localeCompare(a.ends_at ?? a.created_at));
    const currentEnds = current.map((r) => r.ends_at?.slice(0, 10) ?? null);
    lines.push({
      client: clientName(c),
      email: emailOf(c.email),
      phone: text(c.phone),
      phone2: text(c.phone2),
      clubs: [...new Set(list.map((r) => clubName(r.studio_id)))].sort().join(", "),
      hasCurrent: current.length > 0,
      current: current.map((r) => text(r.memberships?.name)).join("; "),
      currentEndsAt: currentEnds.length
        ? currentEnds.reduce<string | null>((a, b) => (a && b ? (a > b ? a : b) : (a ?? b)), null)
        : null,
      lastEnded: ended[0] ? text(ended[0].memberships?.name) : "",
      lastEndedAt: ended[0]?.ends_at?.slice(0, 10) ?? null,
      total: list.length,
    });
  }
  return lines.sort((a, b) => a.client.localeCompare(b.client, "ru"));
}

/** «2026-11-15» → дата Excel (полночь UTC, без сдвига часового пояса). */
export function excelDate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
