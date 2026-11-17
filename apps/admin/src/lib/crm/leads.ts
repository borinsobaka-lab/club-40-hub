/**
 * CRM — источники заявок без сети (CRM.md, «Источники и сквозная воронка»):
 * разбор заявки с формы сайта (поля приходят под разными именами — свой
 * сайт, Tilda, другие конструкторы) и адрес перехода ссылки с меткой.
 */

export type LeadData = {
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  page: string | null;
};

/** Имена полей формы (без регистра) → поле заявки. */
const FIELD_NAMES: Record<keyof LeadData, string[]> = {
  name: ["name", "имя", "fio", "фио", "fullname", "full_name", "first_name", "firstname"],
  phone: ["phone", "tel", "telephone", "телефон", "phone_number", "mobile"],
  email: ["email", "e-mail", "mail", "почта"],
  message: [
    "message",
    "comment",
    "comments",
    "text",
    "textarea",
    "сообщение",
    "комментарий",
    "вопрос",
  ],
  utm_source: ["utm_source"],
  utm_medium: ["utm_medium"],
  utm_campaign: ["utm_campaign"],
  utm_content: ["utm_content"],
  utm_term: ["utm_term"],
  page: ["page", "page_url", "url", "referer", "referrer", "location"],
};

/** Скрытое поле-ловушка: человек его не видит, робот заполняет. */
export const HONEYPOT_FIELDS = ["website", "hp", "company_site"];

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const text = String(v).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

/** Поля формы → заявка; лишние поля не теряются — дописываются к сообщению. */
export function parseLead(fields: Record<string, unknown>): LeadData {
  const byName = new Map<string, unknown>();
  for (const [k, v] of Object.entries(fields)) byName.set(k.trim().toLowerCase(), v);
  const used = new Set<string>();
  const pick = (key: keyof LeadData, max: number) => {
    for (const name of FIELD_NAMES[key]) {
      const value = clean(byName.get(name), max);
      if (value) {
        used.add(name);
        return value;
      }
    }
    return null;
  };
  const lead: LeadData = {
    name: pick("name", 200),
    phone: pick("phone", 40),
    email: pick("email", 200),
    message: pick("message", 3000),
    utm_source: pick("utm_source", 200),
    utm_medium: pick("utm_medium", 200),
    utm_campaign: pick("utm_campaign", 200),
    utm_content: pick("utm_content", 200),
    utm_term: pick("utm_term", 200),
    page: pick("page", 1000),
  };
  // Свои поля формы («Клуб», «Удобное время») — строками в сообщение.
  const skip = new Set([
    ...Object.values(FIELD_NAMES).flat(),
    ...HONEYPOT_FIELDS,
    "tranid",
    "formid",
    "formname",
    "cookies",
    "test",
  ]);
  const extra: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const name = k.trim().toLowerCase();
    if (used.has(name) || skip.has(name)) continue;
    const value = clean(v, 500);
    if (value && extra.length < 15) extra.push(`${k.trim().slice(0, 60)}: ${value}`);
  }
  if (extra.length > 0)
    lead.message = [lead.message, ...extra].filter(Boolean).join("\n").slice(0, 4000);
  return lead;
}

/** Заполнена ловушка — заявку оставил робот. */
export function isBotLead(fields: Record<string, unknown>): boolean {
  return Object.entries(fields).some(
    ([k, v]) => HONEYPOT_FIELDS.includes(k.trim().toLowerCase()) && clean(v, 10) !== null,
  );
}

/** В заявке должен быть телефон (от 7 цифр) или почта. */
export function leadProblem(lead: LeadData): string | null {
  const digits = (lead.phone ?? "").replace(/\D/g, "");
  const emailOk = !!lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email);
  if (digits.length < 7 && !emailOk) return "Укажите телефон или почту";
  return null;
}

export type LinkTarget = {
  code: string;
  target_kind: "whatsapp" | "telegram" | "url";
  target: string;
  text: string | null;
  source: string;
  campaign: string | null;
};

/**
 * Куда вести по ссылке с меткой. WhatsApp — чат с текстом и «#код» (по нему
 * первое сообщение свяжется со ссылкой), Telegram — бот с ?start=код, сайт —
 * адрес с utm-метками (не затирая уже стоящие). null — вести некуда.
 */
export function linkRedirectUrl(link: LinkTarget): string | null {
  if (link.target_kind === "whatsapp") {
    const phone = link.target.replace(/\D/g, "");
    if (phone.length < 7) return null;
    const text = `${link.text?.trim() || "Здравствуйте!"} #${link.code}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }
  if (link.target_kind === "telegram") {
    const bot = link.target
      .trim()
      .replace(/^https?:\/\/t\.me\//i, "")
      .replace(/^@/, "")
      .replace(/[/?].*$/, "");
    if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) return null;
    return `https://t.me/${bot}?start=${link.code}`;
  }
  let url: URL;
  try {
    url = new URL(link.target);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const set = (key: string, value: string | null) => {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  };
  set("utm_source", link.source);
  set("utm_campaign", link.campaign);
  set("utm_content", link.code);
  return url.href;
}

/** Адрес ссылки с меткой на сервере админки. */
export const linkPublicUrl = (origin: string, code: string) => `${origin}/l/${code}`;
/** Адрес приёма заявок формы. */
export const leadFormUrl = (origin: string, token: string) => `${origin}/api/crm/lead/${token}`;

/**
 * Готовый код формы для сайта: поля, скрытая ловушка, перенос utm-меток из
 * адреса страницы. Вставляется в HTML как есть.
 */
export function leadFormSnippet(url: string): string {
  return `<form id="base40-lead">
  <input name="name" placeholder="Имя" required>
  <input name="phone" type="tel" placeholder="Телефон" required>
  <textarea name="message" placeholder="Комментарий"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button type="submit">Отправить</button>
</form>
<script>
(function () {
  var form = document.getElementById("base40-lead");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(form));
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (k.indexOf("utm_") === 0) data[k] = v;
    });
    data.page = location.href;
    fetch("${url}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error();
      form.innerHTML = "Спасибо! Мы свяжемся с вами.";
    }).catch(function () {
      alert("Не удалось отправить заявку. Попробуйте ещё раз.");
    });
  });
})();
</script>`;
}
