/**
 * Выгрузка 1С → файл заливки клиентов и абонементов в пакетные клубы
 * (страница «Доступы» → «Импорт из 1С», функция базы import_1c_chunk —
 * db/migrations/2026-10-18_import_1c.sql). Данные клиентов в репозиторий не
 * кладём: выгрузка и файл заливки живут только у того, кто запускает скрипт.
 *
 *   python3 -I dump-report.py клиенты.xlsx clients.json
 *   python3 -I dump-report.py пакеты.xlsx memberships.json
 *   bun scripts/import-1c/convert.ts clients.json memberships.json import-1c.json [--date=2026-10-17]
 *
 * Отчёты 1С: «Клиенты» (клуб → статус → клиент: пол, дата рождения,
 * регистрации, почта, телефоны) и «Пакеты услуг» (клуб → статус → номенклатура
 * → клиент: стоимость, долг, активирован, действует до, код клиента, документ
 * продажи, телефон, остаток). Абонемент 1С повторяется под каждым клубом, где
 * действует, — уникален по документу продажи, номенклатуре и коду клиента.
 * --date — дата выгрузки (по ней отсекаются абонементы с вышедшим сроком).
 *
 * Правила (решения владельца 2026-10-18):
 *   * Клубы: Чавчавадзе 51 → Lady Stretch Vake, Нуцубидзе 125 → Lady Stretch
 *     Saburtalo. Клуб продажи — клуб карточки клиентки.
 *   * Клиенты — все, кроме явно тестовых и карточек владельца; пол — женский;
 *     «Фамилия Имя [Отчество]» → фамилия — первое слово; пометки в скобках
 *     («(Сотрудник)») — в заметку. Одна почта или одно имя с общим телефоном —
 *     одна карточка (кроме разных людей на одной почте: почту оставляет
 *     карточка с живым абонементом). Телефоны — E.164, грузинский первым,
 *     второй — «Телефон 2», остальные и нераспознанные — в заметку.
 *   * Абонементы клиента находятся по коду 1С: имя + телефон, иначе только
 *     имя, иначе только телефон; не нашлась карточка — заводится из строки
 *     абонемента.
 *   * Номенклатура: КОМБО 16/24/36/50 → Пакет 16 / Premium 24/36/50,
 *     персональные Combo 12/6 → «12 занятий»/«6 занятий», разовое → «Разовое
 *     посещение», «Абонемент для перехода», сертификаты и пакеты, которых у
 *     нас нет, → скрытая «Остаток из 1С». Только тбилисские; пробные не
 *     переносятся совсем.
 *   * Действующие (активен с остатком и сроком; продан и оплачен хоть
 *     частично) — продажи: сумма из 1С (нет — из номенклатуры), долг —
 *     вторым платежом через месяц. Остаток из 1С — групповыми; у
 *     непроданного Premium 36/50 персональная — 1. Старый Premium 36/50 с
 *     остатком 1 рядом с другим живым абонементом — это подарочная
 *     персональная: переносится на текущий, старый «Закончился». Несколько
 *     живых — текущий кончается раньше, остальные в очереди.
 *   * Закрытые и активные без остатка — история «Закончился», без продажи.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { parsePhoneNumberFromString } from "libphonenumber-js/max";

type Row = { r: number; lvl: number; v: unknown[] };

const STUDIO_KEYS: Record<string, string> = {
  "Тбилиси, Чавчавадзе 51": "vake",
  "Тбилиси, Шалва Нуцубидзе 125": "saburtalo",
};
const STUDIO_NAMES: Record<string, string> = {
  vake: "Lady Stretch Vake",
  saburtalo: "Lady Stretch Saburtalo",
};
/** Карточки владельца и явно тестовые записи — не переносим. */
const EXCLUDED_NAMES = new Set(
  [
    "Борин Владимир",
    "Borin Vladimir",
    "клиент 1 клиент клиент 1",
    "Тест Номер Грузия",
    "катя валера",
    "мама виктории",
    "Никифоровой Подруга",
  ].map((n) => normName(n)),
);
const EXCLUDED_EMAILS = new Set(["borin.sobaka@gmail.com"]);
/** Одна почта у разных людей: карточки не объединяются. */
const SHARED_EMAILS = new Set([
  "nona13@gmail.com",
  "katetikhomirova7@gmail.com",
  "sopopopkhadze8@gmail.com",
]);
/** Персональных в подарок у номенклатуры (остаток 1С их включает). */
const GIFT_PERSONAL: Record<string, number> = { "Premium 36": 1, "Premium 50": 1 };
const PERSONAL_CATALOG = new Set(["12 занятий", "6 занятий", "Персональная тренировка"]);
const REMAINDER = "Остаток из 1С";
const STATUS_RANK: Record<string, number> = {
  "Клиент клуба": 3,
  "Бывший клиент клуба": 2,
  "Бывший член клуба": 2,
  "Потенциальный член клуба": 1,
};

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function isoDate(v: unknown): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(str(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const tokens = (s: string) => new Set(normName(s).split(" ").filter(Boolean));
const subsetEither = (a: Set<string>, b: Set<string>) =>
  [...a].every((t) => b.has(t)) || [...b].every((t) => a.has(t));

type Phone = { e164: string; country?: string };

function validPhone(s: string, country?: "GE") {
  const p = parsePhoneNumberFromString(s, country);
  return p?.isValid() ? p : null;
}

/** Номер из 1С: маска «995 (…)» стоит и перед российскими номерами. */
function parsePhoneToken(raw: string): Phone | null {
  const t = raw.trim();
  if (/[a-zа-яё]/i.test(t)) return null;
  let digits = t.replace(/\D/g, "");
  if (!digits) return null;
  let plus = t.startsWith("+") || t.startsWith("(+");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }
  const ok = (p: ReturnType<typeof validPhone>) =>
    p ? { e164: p.number, country: p.country } : null;
  if (digits.startsWith("995")) {
    const rest = digits.slice(3);
    if (rest.length === 9) {
      const p = validPhone("+" + digits);
      if (p) return ok(p);
      // Новые префиксы операторов libphonenumber может ещё не знать.
      if (/^5\d{8}$/.test(rest)) return { e164: "+" + digits, country: "GE" };
    }
    if (/^[78]\d{10}$/.test(rest)) return ok(validPhone("+7" + rest.slice(1)));
    if (/^9\d{9}$/.test(rest)) return ok(validPhone("+7" + rest));
    if (rest.length >= 10) {
      const p = validPhone("+" + rest);
      if (p) return ok(p);
    }
    return ok(validPhone("+" + digits));
  }
  if (plus) return ok(validPhone("+" + digits));
  if (/^5\d{8}$/.test(digits))
    return ok(validPhone(digits, "GE")) ?? { e164: "+995" + digits, country: "GE" };
  if (/^7\d{10}$/.test(digits)) return ok(validPhone("+" + digits));
  if (/^8\d{10}$/.test(digits)) return ok(validPhone("+7" + digits.slice(1)));
  if (/^9\d{9}$/.test(digits)) return ok(validPhone("+7" + digits));
  return ok(validPhone("+" + digits)) ?? ok(validPhone(digits, "GE"));
}

function parsePhones(raw: unknown): { phones: Phone[]; invalid: string[] } {
  const phones: Phone[] = [];
  const invalid: string[] = [];
  for (const tok of str(raw)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const p = parsePhoneToken(tok);
    if (!p) {
      if (tok.replace(/[\s.]/g, "")) invalid.push(tok);
    } else if (!phones.some((x) => x.e164 === p.e164)) phones.push(p);
  }
  return { phones, invalid };
}

function phoneDigits(raw: unknown): string[] {
  return str(raw)
    .split(/[\n,;]+/)
    .map((t) => t.replace(/\D/g, ""))
    .filter((d) => d.length >= 5);
}

const EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9_-])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** Имя из 1С: пометки в скобках и дата впереди («05.03 Keti») — не имя. */
function splitName(raw: string): { first: string | null; last: string | null; marks: string[] } {
  const marks = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  let words = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*\d{1,2}[./]\d{1,2}\s+/, "")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  // «Sara Sara» — в 1С так записывали имя без фамилии.
  if (words.length === 2 && words[0].toLowerCase() === words[1].toLowerCase()) words = [words[0]];
  if (words.length === 0) return { first: null, last: null, marks };
  if (words.length === 1) return { first: words[0], last: null, marks };
  return { last: words[0], first: words.slice(1).join(" "), marks };
}

// ---------------------------------------------------------------------------
// Отчёты
// ---------------------------------------------------------------------------

type ClientRow = {
  i: number;
  unit: string;
  status: string;
  name: string;
  birth: string | null;
  reg: string | null;
  email: string | null;
  emailRaw: string;
  phones: Phone[];
  phoneInvalid: string[];
  /** Цифры номеров как записаны (опечатка в номере — в обоих отчётах одна). */
  phoneDigits: string[];
};

type PackRow = {
  unit: string;
  status: string;
  nom: string;
  nomCode: string;
  client: string;
  price: number | null;
  debt: number | null;
  activated: string | null;
  validTo: string | null;
  comment: string;
  code: string;
  doc: string;
  phones: Phone[];
  phoneDigits: string[];
  left: number | null;
};

function parseClients(rows: Row[]): ClientRow[] {
  const out: ClientRow[] = [];
  let unit = "";
  let status = "";
  for (const row of rows.slice(5)) {
    const v = row.v;
    if (row.lvl === 0) unit = str(v[0]);
    else if (row.lvl === 1) status = str(v[0]);
    else {
      const emailRaw = str(v[6]);
      const email = emailRaw.replace(/\s+/g, "").toLowerCase();
      const ph = parsePhones(v[9]);
      out.push({
        i: out.length,
        unit,
        status,
        name: str(v[0]),
        birth: isoDate(v[3]),
        reg: isoDate(v[4]),
        email: email && EMAIL_RE.test(email) ? email : null,
        emailRaw,
        phones: ph.phones,
        phoneInvalid: ph.invalid,
        phoneDigits: phoneDigits(v[9]),
      });
    }
  }
  return out;
}

function parsePacks(rows: Row[]): Map<string, PackRow & { units: Set<string> }> {
  const out = new Map<string, PackRow & { units: Set<string> }>();
  let unit = "";
  let status = "";
  let nom = "";
  let nomCode = "";
  for (const row of rows.slice(6)) {
    const v = row.v;
    if (row.lvl === 0) unit = str(v[0]);
    else if (row.lvl === 1) status = str(v[0]);
    else if (row.lvl === 2) {
      nom = str(v[0]);
      nomCode = str(v[13]);
    } else {
      const code = str(v[14]);
      const doc = str(v[15]);
      const key = `${doc}|${nomCode}|${code}`;
      const seen = out.get(key);
      if (seen) {
        seen.units.add(unit);
        continue;
      }
      out.set(key, {
        unit,
        units: new Set([unit]),
        status,
        nom,
        nomCode,
        client: str(v[0]),
        price: num(v[3]),
        debt: num(v[4]),
        activated: isoDate(v[6]),
        validTo: isoDate(v[8]),
        comment: str(v[13]),
        code,
        doc,
        phones: parsePhones(v[16]).phones,
        phoneDigits: phoneDigits(v[16]),
        left: num(v[17]),
      });
    }
  }
  return out;
}

function catalogOf(nom: string): string | null {
  const n = nom.replace(/\s+/g, " ").trim();
  if (!/Тбилиси|Фитнес Фест/.test(n)) return null;
  if (/Пробное/i.test(n)) return null;
  if (/^КОМБО 16 /.test(n)) return "Пакет 16";
  if (/^КОМБО 24 занятия Тбилиси/.test(n)) return "Premium 24";
  if (/^КОМБО 36 /.test(n)) return "Premium 36";
  if (/^КОМБО 50 /.test(n)) return "Premium 50";
  if (/^Combo 12 персональных/.test(n)) return "12 занятий";
  if (/^Combo 6 персональных/.test(n)) return "6 занятий";
  if (/^Разовое занятие Тбилиси/.test(n)) return "Разовое посещение";
  return REMAINDER;
}

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

type Membership = {
  ref: string;
  kind: "sale" | "history";
  catalog: string;
  sold_at: string;
  order: number;
  status?: "active" | "pending" | "expired";
  starts_on_first_visit?: boolean;
  started_at: string | null;
  ends_at: string | null;
  visits_left?: number;
  personal_left?: number;
  total?: number | null;
  debt?: number;
  comment?: string;
};

type Group = {
  rows: ClientRow[];
  codes: Set<string>;
  packs: PackRow[];
  fromPack?: PackRow;
};

function main() {
  const args = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dateArg = Bun.argv.find((a) => a.startsWith("--date="))?.slice(7);
  if (args.length !== 3) {
    console.error(
      "usage: bun convert.ts clients.json memberships.json out.json [--date=YYYY-MM-DD]",
    );
    process.exit(1);
  }
  const exportDate =
    dateArg ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tbilisi" });
  const [clientsPath, packsPath, outPath] = args;
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Row[];

  const allClients = parseClients(read(clientsPath));
  const packs = [...parsePacks(read(packsPath)).values()];
  const report: Record<string, unknown[]> = {
    excluded: [],
    unmatchedCodes: [],
    weakMatches: [],
    sharedEmails: [],
    unknownUnit: [],
  };

  const clients = allClients.filter((c) => {
    const ex = EXCLUDED_NAMES.has(normName(c.name)) || (c.email && EXCLUDED_EMAILS.has(c.email));
    if (ex) report.excluded.push(c.name);
    if (!STUDIO_KEYS[c.unit]) report.unknownUnit.push(`${c.name}: ${c.unit}`);
    return !ex && STUDIO_KEYS[c.unit];
  });

  // --- объединение дублей: почта; имя + общий телефон
  const parent = clients.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const byEmail = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  clients.forEach((c, i) => {
    if (c.email && !SHARED_EMAILS.has(c.email))
      (byEmail.get(c.email) ?? byEmail.set(c.email, []).get(c.email)!).push(i);
    for (const p of c.phones) (byPhone.get(p.e164) ?? byPhone.set(p.e164, []).get(p.e164)!).push(i);
  });
  for (const ix of byEmail.values()) ix.slice(1).forEach((i) => union(ix[0], i));
  // Одна и та же клиентка, заведённая в двух клубах в один день.
  const byNameReg = new Map<string, number[]>();
  clients.forEach((c, i) => {
    const k = `${normName(c.name)}|${c.reg}`;
    if (normName(c.name).includes(" ")) (byNameReg.get(k) ?? byNameReg.set(k, []).get(k)!).push(i);
  });
  for (const ix of byNameReg.values()) ix.slice(1).forEach((i) => union(ix[0], i));
  for (const ix of byPhone.values()) {
    for (let a = 0; a < ix.length; a++)
      for (let b = a + 1; b < ix.length; b++)
        if (subsetEither(tokens(clients[ix[a]].name), tokens(clients[ix[b]].name)))
          union(ix[a], ix[b]);
  }
  const groupsByRoot = new Map<number, Group>();
  clients.forEach((c, i) => {
    const root = find(i);
    const g =
      groupsByRoot.get(root) ??
      groupsByRoot.set(root, { rows: [], codes: new Set(), packs: [] }).get(root)!;
    g.rows.push(c);
  });
  const groups = [...groupsByRoot.values()];
  const groupOfRow = new Map<ClientRow, Group>();
  for (const g of groups) for (const r of g.rows) groupOfRow.set(r, g);

  // --- код клиента 1С → карточка
  const rowsByName = new Map<string, ClientRow[]>();
  for (const c of clients)
    (
      rowsByName.get(normName(c.name)) ??
      rowsByName.set(normName(c.name), []).get(normName(c.name))!
    ).push(c);
  const packsByCode = new Map<string, PackRow[]>();
  for (const p of packs)
    (packsByCode.get(p.code) ?? packsByCode.set(p.code, []).get(p.code)!).push(p);

  const today = exportDate;
  const classify = (p: PackRow): "sale" | "history" | null => {
    const cat = catalogOf(p.nom);
    if (!cat) return null;
    if (p.status === "Закрыт") return "history";
    if (p.status === "Активен") {
      if (!p.left || p.left <= 0 || (p.validTo && p.validTo < today)) return "history";
      return "sale";
    }
    // «Продан» — не активирован: только если оплачен хоть частично.
    if (p.debt && p.price && p.debt >= p.price) return null;
    return "sale";
  };

  for (const [code, list] of packsByCode) {
    const p0 = list[0];
    const importable = list.some((p) => classify(p) !== null);
    const nameRows = rowsByName.get(normName(p0.client)) ?? [];
    const phoneSet = new Set(p0.phones.map((p) => p.e164));
    const digitSet = new Set(list.flatMap((p) => p.phoneDigits));
    const phoneRows = clients.filter(
      (c) =>
        c.phones.some((p) => phoneSet.has(p.e164)) || c.phoneDigits.some((d) => digitSet.has(d)),
    );
    const groupsOf = (rows: ClientRow[]) => new Set(rows.map((r) => groupOfRow.get(r)!));
    let g: Group | null = null;
    let how = "";
    const both = groupsOf(nameRows.filter((r) => phoneRows.includes(r)));
    const byName = groupsOf(nameRows);
    const byPh = groupsOf(phoneRows);
    if (both.size === 1) [g] = both;
    else if (both.size === 0 && byName.size === 1) {
      [g] = byName;
      how = "только имя";
    } else if (both.size === 0 && byName.size === 0 && byPh.size === 1) {
      [g] = byPh;
      how = "только телефон";
    }
    // Тёзки без общего телефона: только история (статус клуба) — к старшей
    // по статусу карточке; живые абонементы так не привязываем.
    if (!g && both.size === 0 && byName.size > 1 && !list.some((p) => classify(p) === "sale")) {
      g = [...byName].sort((a, b) => rank(b) - rank(a))[0];
      how = "тёзки, только история";
    }
    if (g && how && importable)
      report.weakMatches.push(
        `${how}: «${p0.client}» ${p0.phones.map((p) => p.e164).join(", ")} → «${g.rows[0].name}»`,
      );
    if (!g) {
      if (!importable) continue;
      if (EXCLUDED_NAMES.has(normName(p0.client))) continue;
      report.unmatchedCodes.push(
        `${p0.client} (${code}) ${p0.phones.map((p) => p.e164).join(", ")}`,
      );
      g = { rows: [], codes: new Set(), packs: [], fromPack: p0 };
      groups.push(g);
    }
    g.codes.add(code);
    g.packs.push(...list);
  }

  // --- карточки
  const outClients: unknown[] = [];
  const usedRefs = new Set<string>();
  const stats = {
    clients: 0,
    sales: 0,
    history: 0,
    transfers: 0,
    debts: 0,
    byCatalog: {} as Record<string, number>,
  };
  const emailOwner = new Map<string, Group>();
  // Разные люди на одной почте: почта — у карточки с живым абонементом.
  const hasLive = (g: Group) => g.packs.some((p) => classify(p) === "sale");
  for (const email of SHARED_EMAILS) {
    const gs = groups.filter((g) => g.rows.some((r) => r.email === email));
    // Своя почта у карточки уже есть — общую оставляем другой.
    const ownEmail = (g: Group) => g.rows.some((r) => r.email && r.email !== email);
    gs.sort(
      (a, b) =>
        Number(hasLive(b)) - Number(hasLive(a)) ||
        Number(ownEmail(a)) - Number(ownEmail(b)) ||
        rank(b) - rank(a),
    );
    if (gs[0]) emailOwner.set(email, gs[0]);
    report.sharedEmails.push(
      `${email}: ${gs.map((g) => g.rows[0].name).join(" / ")} → почта у «${gs[0]?.rows[0].name}»`,
    );
  }
  function rank(g: Group) {
    return Math.max(0, ...g.rows.map((r) => STATUS_RANK[r.status] ?? 0));
  }

  for (const g of groups) {
    const rows = [...g.rows].sort(
      (a, b) =>
        (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) ||
        (b.reg ?? "").localeCompare(a.reg ?? ""),
    );
    const primary = rows[0];
    const notes: string[] = [];
    const name = splitName(primary?.name ?? g.fromPack!.client);
    const marks = new Set(
      (rows.length ? rows.map((r) => r.name) : [g.fromPack!.client]).flatMap(
        (n) => splitName(n).marks,
      ),
    );
    for (const m of marks) notes.push(/сотрудник/i.test(m) ? "Сотрудник" : `В 1С: ${m}`);
    if (primary) notes.push(`Перенесено из 1С, статус — «${primary.status}»`);
    else
      notes.push(
        "Перенесено из 1С: карточки не было в отчёте клиентов (клиент другого клуба сети)",
      );

    // Почта
    let email: string | null = null;
    // Сначала своя почта, общая на двоих — после.
    for (const r of [...rows].sort(
      (a, b) => Number(SHARED_EMAILS.has(a.email ?? "")) - Number(SHARED_EMAILS.has(b.email ?? "")),
    )) {
      if (!r.email) {
        if (r.emailRaw) notes.push(`Почта в 1С с ошибкой: ${r.emailRaw}`);
        continue;
      }
      if (SHARED_EMAILS.has(r.email) && emailOwner.get(r.email) !== g) {
        notes.push(`Почта ${r.email} — у другой карточки (одна почта на двоих)`);
        continue;
      }
      email ??= r.email;
    }

    // Телефоны: грузинский первым
    const phones: Phone[] = [];
    const add = (p: Phone) => {
      if (!phones.some((x) => x.e164 === p.e164)) phones.push(p);
    };
    rows.forEach((r) => r.phones.forEach(add));
    g.packs.forEach((p) => p.phones.forEach(add));
    phones.sort((a, b) => Number(b.country === "GE") - Number(a.country === "GE"));
    if (phones.length > 2)
      notes.push(
        `Другие телефоны: ${phones
          .slice(2)
          .map((p) => p.e164)
          .join(", ")}`,
      );
    const invalid = [...new Set(rows.flatMap((r) => r.phoneInvalid))];
    if (invalid.length) notes.push(`Телефон в 1С не распознан: ${invalid.join(", ")}`);
    const comments = [...new Set(g.packs.map((p) => p.comment).filter(Boolean))];
    if (comments.length) notes.push(`Комментарий в 1С: ${comments.join("; ")}`);

    const unit =
      primary?.unit ??
      (g.fromPack!.units.has("Тбилиси, Чавчавадзе 51")
        ? "Тбилиси, Чавчавадзе 51"
        : "Тбилиси, Шалва Нуцубидзе 125");
    const studio = STUDIO_KEYS[unit] ?? "vake";
    const regs = rows.map((r) => r.reg).filter(Boolean) as string[];
    const soldDates = g.packs
      .map((p) => isoDate(/от (\d\d\.\d\d\.\d{4})/.exec(p.doc)?.[1]))
      .filter(Boolean) as string[];
    const registration = [...regs, ...(regs.length ? [] : soldDates)].sort()[0] ?? null;
    const birthday =
      rows.map((r) => r.birth).find((b) => b && b >= "1930-01-01" && b <= "2015-12-31") ?? null;

    let ref =
      "1c-" +
      ([...g.codes].sort()[0] ??
        `r${hash(`${primary.name}|${primary.reg}|${primary.phones.map((p) => p.e164).join()}`)}`);
    while (usedRefs.has(ref)) ref += "x";
    usedRefs.add(ref);

    outClients.push({
      ref,
      studio,
      last_name: name.last,
      first_name: name.first,
      gender: "female",
      birthday,
      registration_date: registration,
      email,
      phone: phones[0]?.e164 ?? null,
      phone2: phones[1]?.e164 ?? null,
      notes: notes.join("\n"),
      memberships: buildMemberships(g.packs),
    });
    stats.clients++;
  }

  function buildMemberships(list: PackRow[]): Membership[] {
    const out: Membership[] = [];
    const sold = (p: PackRow) => isoDate(/от (\d\d\.\d\d\.\d{4})/.exec(p.doc)?.[1]) ?? today;
    const docNo = (p: PackRow) => /(\d+-\d+)/.exec(p.doc)?.[1] ?? p.doc;
    const ordered = [...list].sort((a, b) => sold(a).localeCompare(sold(b)));
    const live: (Membership & { pack: PackRow })[] = [];
    ordered.forEach((p, order) => {
      const kind = classify(p);
      if (!kind) return;
      const catalog = catalogOf(p.nom)!;
      const base = {
        ref: `${docNo(p)}/${p.nomCode}/${p.code}`,
        kind,
        catalog,
        sold_at: sold(p),
        order,
        started_at: p.activated ?? (kind === "history" ? sold(p) : null),
        ends_at: p.validTo,
      };
      if (kind === "history") {
        out.push({ ...base, status: "expired" });
        stats.history++;
      } else {
        live.push({
          ...base,
          total: p.price,
          debt: p.debt ?? 0,
          comment: `1С: ${p.doc.replace(/\s+/g, " ").trim()} · ${p.nom.replace(/\s+/g, " ").trim()}`,
          pack: p,
        });
      }
    });

    for (const balance of ["group", "personal"] as const) {
      const ofKind = live.filter(
        (m) => (PERSONAL_CATALOG.has(m.catalog) ? "personal" : "group") === balance,
      );
      if (!ofKind.length) continue;
      // Старый Premium 36/50 с остатком 1 рядом с другим живым — подарочная
      // персональная: переносим на текущий.
      let transfers = ofKind.filter(
        (m) => GIFT_PERSONAL[m.catalog] && m.pack.status === "Активен" && m.pack.left === 1,
      );
      if (transfers.length === ofKind.length) transfers = transfers.slice(0, -1);
      const rest = ofKind
        .filter((m) => !transfers.includes(m))
        .sort((a, b) => {
          const aw = a.pack.status === "Активен" ? 0 : 1;
          const bw = b.pack.status === "Активен" ? 0 : 1;
          if (aw !== bw) return aw - bw;
          return aw === 0
            ? (a.ends_at ?? "9999").localeCompare(b.ends_at ?? "9999")
            : a.sold_at.localeCompare(b.sold_at);
        });
      for (const m of transfers) {
        Object.assign(m, {
          status: "expired",
          starts_on_first_visit: false,
          visits_left: 0,
          personal_left: 0,
          comment: `${m.comment} · подарочная персональная перенесена на текущий абонемент`,
        });
        stats.transfers++;
      }
      rest.forEach((m, i) => {
        const activated = m.pack.status === "Активен";
        const left = Math.max(0, m.pack.left ?? 0);
        const gift = activated ? 0 : Math.min(left, GIFT_PERSONAL[m.catalog] ?? 0);
        const personalLeft =
          (balance === "personal" ? left : gift) + (i === 0 ? transfers.length : 0);
        Object.assign(m, {
          status: i === 0 ? "active" : "pending",
          starts_on_first_visit: !activated,
          started_at: activated ? m.started_at : null,
          ends_at: activated ? m.ends_at : null,
          visits_left: balance === "personal" ? 0 : left - gift,
          personal_left: personalLeft,
        });
      });
      for (const m of ofKind) {
        const { pack, ...rest2 } = m;
        out.push(rest2);
        stats.sales++;
        if (m.debt) stats.debts++;
        const k = `${m.catalog} — ${m.status === "expired" ? "закончился (персональная перенесена)" : pack.status === "Активен" ? (m.status === "active" ? "действует" : "в очереди") : m.status === "active" ? "ожидает посещения" : "в очереди, ждёт посещения"}`;
        stats.byCatalog[k] = (stats.byCatalog[k] ?? 0) + 1;
      }
    }
    return out.sort((a, b) => a.order - b.order);
  }

  const payload = {
    version: 1,
    source: `1С, выгрузка ${exportDate}`,
    studios: STUDIO_NAMES,
    clients: outClients,
  };
  writeFileSync(outPath, JSON.stringify(payload));
  const withEmail = (outClients as { email: string | null }[]).filter((c) => c.email).length;
  console.log(JSON.stringify({ exportDate, ...stats, withEmail }, null, 2));
  for (const [k, v] of Object.entries(report)) {
    console.log(`\n${k}: ${v.length}`);
    for (const x of v) console.log("  " + x);
  }
}

function hash(s: string): string {
  return new Bun.CryptoHasher("sha1").update(s).digest("hex").slice(0, 12);
}

main();
