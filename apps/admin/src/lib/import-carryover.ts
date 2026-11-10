// Импорт клиентов купленной студии с абонементом переноса («Управление» →
// «Импорт переноса», решение владельца 2026-11-10). Владелец загружает
// выгрузку прежней студии как есть (xlsx: «Клиент», «Номер телефона»,
// «Абонемент», «Осталось занятий», «Начало», «Окончание», «Долг»…), страница
// разбирает её здесь и отдаёт строки базе пачками (RPC carryover_import_chunk,
// db/migrations/2026-11-10_zz_carryover_import.sql). Без React — покрыто
// тестом import-carryover.test.ts. Файл с данными клиентов в репозиторий не
// кладём.

import { parseDateCell, parseNumberCell, norm, type Cell } from "@/lib/analytics/import";
import { checkPhone } from "@/lib/contacts";

/** Строка выгрузки, готовая к переносу. */
export type CarryoverRow = {
  /** Номер абонемента в прежней студии — ключ строки (повтор не задваивает). */
  ref: string;
  last_name: string;
  first_name: string;
  /** E.164; null — номера нет или он не разобран (карточка без телефона). */
  phone: string | null;
  /** Номер как в файле — для предпросмотра. */
  phoneRaw: string;
  /** Дата продажи в прежней студии — регистрация новой карточки. */
  registered_on: string | null;
  /** Название абонемента в прежней студии. */
  membershipName: string;
  /** Остаток занятий (с подарочными). */
  visits: number;
  starts_on: string;
  ends_on: string;
  debt: number;
  /** Комментарий к продаже: что было в прежней студии. */
  comment: string;
};

export type CarryoverProblem = { line: number; name: string; text: string; skipped: boolean };

export type CarryoverParse = { rows: CarryoverRow[]; problems: CarryoverProblem[] };

/** Колонки выгрузки: ключ → варианты заголовка (без регистра и знаков). */
const COLUMNS = {
  created: ["создание", "дата продажи"],
  ref: ["номер", "номер абонемента"],
  client: ["клиент", "фио"],
  phone: ["номер телефона", "телефон"],
  membership: ["абонемент"],
  active: ["действующий"],
  total: ["итоговая цена"],
  paid: ["оплачено"],
  debt: ["долг"],
  starts: ["начало"],
  ends: ["окончание"],
  left: ["осталось занятий", "осталось"],
  note: ["примечание", "комментарий"],
} as const;
type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: ColumnKey[] = ["ref", "client", "phone", "left", "starts", "ends"];

const COLUMN_LABEL: Record<ColumnKey, string> = {
  created: "Создание",
  ref: "Номер",
  client: "Клиент",
  phone: "Номер телефона",
  membership: "Абонемент",
  active: "Действующий",
  total: "Итоговая цена",
  paid: "Оплачено",
  debt: "Долг",
  starts: "Начало",
  ends: "Окончание",
  left: "Осталось занятий",
  note: "Примечание",
};

const text = (v: Cell) => (v instanceof Date ? "" : String(v ?? "").trim());

function headerMap(header: Cell[]): Partial<Record<ColumnKey, number>> {
  const cells = header.map((h) => norm(h));
  const map: Partial<Record<ColumnKey, number>> = {};
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const i = cells.findIndex((c) => (COLUMNS[key] as readonly string[]).includes(c));
    if (i >= 0) map[key] = i;
  }
  return map;
}

/**
 * Телефон из выгрузки → E.164: «995 (59) 956 0575», «7 (916) 609 3835»,
 * «+995 599…», «599 95 60 75» (без кода — Грузия). Не разобрали — null.
 */
export function parseImportPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^00/, "");
  if (!digits) return null;
  const intl = checkPhone("+" + digits);
  if (intl.status === "valid") return intl.e164;
  const local = checkPhone(digits, "GE");
  if (local.status === "valid") return local.e164;
  // Новые префиксы грузинских операторов библиотека может ещё не знать.
  if (/^9955\d{8}$/.test(digits)) return "+" + digits;
  if (/^5\d{8}$/.test(digits)) return "+995" + digits;
  return null;
}

/** «Фамилия Имя Отчество» → фамилия и остальное. */
export function splitName(full: string): { last_name: string; first_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { last_name: parts[0] ?? "", first_name: parts.slice(1).join(" ") };
}

const money = (n: number) => `${Math.round(n * 100) / 100} ₾`;

/**
 * Разбор листа выгрузки. Переносятся действующие абонементы («Действующий»
 * не «нет») с остатком > 0 и датами начала и окончания; остальные — в
 * problems с skipped. Телефон не разобран — строка переносится без
 * телефона (problems, не skipped).
 */
export function parseCarryoverSheet(sheet: Cell[][]): CarryoverParse {
  const headerIdx = sheet.findIndex((r) => {
    const m = headerMap(r);
    return m.client !== undefined && m.left !== undefined;
  });
  if (headerIdx < 0) {
    throw new Error(
      "Не нашли строку заголовков: нужны колонки «Клиент», «Номер телефона», «Номер», «Осталось занятий», «Начало», «Окончание».",
    );
  }
  const col = headerMap(sheet[headerIdx]);
  const missing = REQUIRED.filter((k) => col[k] === undefined);
  if (missing.length) {
    throw new Error(
      `В файле нет колонок: ${missing.map((k) => `«${COLUMN_LABEL[k]}»`).join(", ")}.`,
    );
  }
  const get = (r: Cell[], k: ColumnKey): Cell => (col[k] === undefined ? null : r[col[k]!]);

  const rows: CarryoverRow[] = [];
  const problems: CarryoverProblem[] = [];
  const seen = new Set<string>();
  sheet.slice(headerIdx + 1).forEach((r, i) => {
    const line = headerIdx + i + 2;
    const name = text(get(r, "client"));
    if (!name && !text(get(r, "ref"))) return; // пустая строка
    const skip = (t: string) => problems.push({ line, name, text: t, skipped: true });

    const active = norm(get(r, "active"));
    if (active === "нет" || active === "no") return skip("абонемент не действующий");
    const refNum = parseNumberCell(get(r, "ref"));
    const ref = refNum != null ? String(refNum) : text(get(r, "ref"));
    if (!ref) return skip("нет номера абонемента");
    if (seen.has(ref)) return skip(`номер ${ref} повторяется`);
    if (!name) return skip("нет имени клиента");
    const left = parseNumberCell(get(r, "left"));
    if (left == null || !Number.isInteger(left) || left <= 0) return skip("нет остатка занятий");
    const starts = parseDateCell(get(r, "starts"))?.day;
    const ends = parseDateCell(get(r, "ends"))?.day;
    if (!starts || !ends) return skip("нет даты начала или окончания");
    if (ends < starts) return skip("окончание раньше начала");

    const phoneRaw = text(get(r, "phone"));
    const phone = parseImportPhone(phoneRaw);
    if (!phone) {
      problems.push({
        line,
        name,
        text: phoneRaw ? `телефон «${phoneRaw}» не разобран — без телефона` : "без телефона",
        skipped: false,
      });
    }
    const debt = Math.max(0, parseNumberCell(get(r, "debt")) ?? 0);
    const membershipName = text(get(r, "membership"));
    const total = parseNumberCell(get(r, "total"));
    const paid = parseNumberCell(get(r, "paid"));
    const note = text(get(r, "note"));
    const comment = [
      `Перенос из прежней студии: «${membershipName || "абонемент"}» № ${ref}`,
      total != null && paid != null ? `, оплачено ${money(paid)} из ${money(total)}` : "",
      debt > 0 ? `, долг ${money(debt)}` : "",
      ".",
      note ? ` ${note}` : "",
    ].join("");

    seen.add(ref);
    rows.push({
      ref,
      ...splitName(name),
      phone,
      phoneRaw,
      registered_on: parseDateCell(get(r, "created"))?.day ?? null,
      membershipName,
      visits: left,
      starts_on: starts,
      ends_on: ends,
      debt,
      comment,
    });
  });
  return { rows, problems };
}

export type CarryoverSummary = {
  rows: number;
  visits: number;
  withDebt: number;
  debtTotal: number;
  /** Срок уже прошёл (переносится как есть). */
  expired: number;
  withoutPhone: number;
};

export function summarizeCarryover(rows: CarryoverRow[], today: string): CarryoverSummary {
  return {
    rows: rows.length,
    visits: rows.reduce((n, r) => n + r.visits, 0),
    withDebt: rows.filter((r) => r.debt > 0).length,
    debtTotal: rows.reduce((n, r) => n + r.debt, 0),
    expired: rows.filter((r) => r.ends_on < today).length,
    withoutPhone: rows.filter((r) => !r.phone).length,
  };
}

/** Пачки для carryover_import_chunk: только поля, которые читает база. */
export function carryoverChunks(
  rows: CarryoverRow[],
  opts: { studioId: string; membershipId: string; debtDue: string },
  size = 50,
) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push({
      studio_id: opts.studioId,
      membership_id: opts.membershipId,
      debt_due: opts.debtDue,
      rows: rows.slice(i, i + size).map((r) => ({
        ref: r.ref,
        last_name: r.last_name,
        first_name: r.first_name,
        phone: r.phone,
        registered_on: r.registered_on,
        visits: r.visits,
        starts_on: r.starts_on,
        ends_on: r.ends_on,
        debt: r.debt,
        comment: r.comment,
      })),
    });
  }
  return chunks;
}

export type CarryoverResult = {
  clients_created: number;
  clients_reused: number;
  sales_created: number;
  sales_skipped: number;
};

export const emptyCarryoverResult = (): CarryoverResult => ({
  clients_created: 0,
  clients_reused: 0,
  sales_created: 0,
  sales_skipped: 0,
});

export function addCarryoverResult(a: CarryoverResult, b: unknown): CarryoverResult {
  const r = (b ?? {}) as Partial<CarryoverResult>;
  return {
    clients_created: a.clients_created + (r.clients_created ?? 0),
    clients_reused: a.clients_reused + (r.clients_reused ?? 0),
    sales_created: a.sales_created + (r.sales_created ?? 0),
    sales_skipped: a.sales_skipped + (r.sales_skipped ?? 0),
  };
}
