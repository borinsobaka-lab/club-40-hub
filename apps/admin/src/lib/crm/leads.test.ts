import { describe, expect, test } from "bun:test";

import { isBotLead, leadFormSnippet, leadProblem, linkRedirectUrl, parseLead } from "./leads";

describe("заявка с формы сайта", () => {
  test("поля под разными именами, лишние — в сообщение", () => {
    const lead = parseLead({
      Name: "  Анна   Иванова ",
      Phone: "+995 555 12 34 56",
      Email: "anna@example.com",
      Comment: "Хочу на пробное",
      "Удобное время": "вечер",
      utm_source: "instagram",
      UTM_CAMPAIGN: "Ноябрь",
      tranid: "123:456",
      formid: "form1",
      page: "https://site.example/promo?utm_source=instagram",
    });
    expect(lead).toMatchObject({
      name: "Анна Иванова",
      phone: "+995 555 12 34 56",
      email: "anna@example.com",
      message: "Хочу на пробное\nУдобное время: вечер",
      utm_source: "instagram",
      utm_campaign: "Ноябрь",
      utm_medium: null,
      page: "https://site.example/promo?utm_source=instagram",
    });
  });

  test("русские имена полей, числа, пустые и нестроковые значения", () => {
    const lead = parseLead({ Имя: "Нино", Телефон: 555123456, почта: "", extra: { a: 1 } });
    expect(lead).toMatchObject({ name: "Нино", phone: "555123456", email: null, message: null });
  });

  test("нужен телефон или почта", () => {
    expect(leadProblem(parseLead({ name: "Анна" }))).toBe("Укажите телефон или почту");
    expect(leadProblem(parseLead({ phone: "12-34" }))).not.toBeNull();
    expect(leadProblem(parseLead({ email: "не почта" }))).not.toBeNull();
    expect(leadProblem(parseLead({ phone: "555 123 456" }))).toBeNull();
    expect(leadProblem(parseLead({ email: "a@b.ge" }))).toBeNull();
  });

  test("ловушка для роботов", () => {
    expect(isBotLead({ name: "x", website: "http://spam" })).toBe(true);
    expect(isBotLead({ name: "x", website: "" })).toBe(false);
    expect(isBotLead({ name: "x" })).toBe(false);
    // Ловушка в сообщение не попадает.
    expect(parseLead({ phone: "555123456", website: "spam" }).message).toBeNull();
  });

  test("код формы шлёт заявку на адрес формы", () => {
    const html = leadFormSnippet("https://admin.example/api/crm/lead/abc");
    expect(html).toContain('fetch("https://admin.example/api/crm/lead/abc"');
    expect(html).toContain('name="website"');
  });
});

describe("ссылка с меткой", () => {
  const base = { code: "ab12cd", source: "Листовки", campaign: "Ваке, ноябрь", text: null };

  test("WhatsApp: номер цифрами, текст с кодом", () => {
    expect(
      linkRedirectUrl({ ...base, target_kind: "whatsapp", target: "+995 555 11-12-22", text: "Хочу записаться" }),
    ).toBe(`https://wa.me/995555111222?text=${encodeURIComponent("Хочу записаться #ab12cd")}`);
    expect(linkRedirectUrl({ ...base, target_kind: "whatsapp", target: "+995 555 11-12-22" })).toContain(
      encodeURIComponent("Здравствуйте! #ab12cd"),
    );
    expect(linkRedirectUrl({ ...base, target_kind: "whatsapp", target: "нет" })).toBeNull();
  });

  test("Telegram: ник бота в любом виде", () => {
    for (const target of ["@base40_bot", "base40_bot", "https://t.me/base40_bot", "https://t.me/base40_bot?start=x"])
      expect(linkRedirectUrl({ ...base, target_kind: "telegram", target })).toBe("https://t.me/base40_bot?start=ab12cd");
    expect(linkRedirectUrl({ ...base, target_kind: "telegram", target: "не ник!" })).toBeNull();
  });

  test("сайт: utm-метки дописываются, стоящие не затираются; только https", () => {
    const url = new URL(
      linkRedirectUrl({ ...base, target_kind: "url", target: "https://site.example/promo?utm_source=flyer&x=1" })!,
    );
    expect(url.searchParams.get("utm_source")).toBe("flyer");
    expect(url.searchParams.get("utm_campaign")).toBe("Ваке, ноябрь");
    expect(url.searchParams.get("utm_content")).toBe("ab12cd");
    expect(url.searchParams.get("x")).toBe("1");
    expect(linkRedirectUrl({ ...base, target_kind: "url", target: "http://site.example" })).toBeNull();
    expect(linkRedirectUrl({ ...base, target_kind: "url", target: "javascript:alert(1)" })).toBeNull();
  });
});
