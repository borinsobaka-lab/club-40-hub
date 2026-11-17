import { describe, expect, test } from "bun:test";

import {
  ageLabel,
  EMPTY_FILTER,
  eventText,
  filterDeals,
  groupByStage,
  nextTaskByDeal,
  parseBudget,
  parseTags,
  percent,
  waitLabel,
  accountLabel,
  automationLabel,
  durationLabel,
  fillTemplate,
  joinDuration,
  reorderIds,
  sortStages,
  splitDuration,
  sumBudget,
  taskState,
} from "./logic";
import type { CrmDeal } from "./types";

const deal = (over: Partial<CrmDeal>): CrmDeal => ({
  id: "d1",
  title: "Сделка",
  pipeline_id: "p",
  stage_id: "s1",
  contact_id: null,
  studio_id: null,
  responsible_id: null,
  budget: null,
  source: null,
  tags: [],
  loss_reason_id: null,
  stage_entered_at: "2026-11-17T10:00:00Z",
  closed_at: null,
  created_at: "2026-11-17T10:00:00Z",
  updated_at: "2026-11-17T10:00:00Z",
  contact: null,
  ...over,
});

describe("CRM — логика", () => {
  test("этапы: обычные по порядку, затем успех и отказ", () => {
    const s = sortStages([
      { kind: "lost" as const, sort_order: 1, created_at: "1", n: "lost" },
      { kind: "open" as const, sort_order: 2, created_at: "1", n: "b" },
      { kind: "won" as const, sort_order: 0, created_at: "1", n: "won" },
      { kind: "open" as const, sort_order: 1, created_at: "1", n: "a" },
    ]);
    expect(s.map((x) => x.n)).toEqual(["a", "b", "won", "lost"]);
  });

  test("состояние задачи", () => {
    const now = new Date(2026, 10, 17, 12, 0);
    expect(taskState(new Date(2026, 10, 17, 11, 0).toISOString(), now)).toBe("overdue");
    expect(taskState(new Date(2026, 10, 17, 18, 0).toISOString(), now)).toBe("today");
    expect(taskState(new Date(2026, 10, 18, 9, 0).toISOString(), now)).toBe("future");
  });

  test("ближайшая задача сделки — без выполненных", () => {
    const m = nextTaskByDeal([
      { deal_id: "a", due_at: "2026-11-20", done_at: null },
      { deal_id: "a", due_at: "2026-11-18", done_at: null },
      { deal_id: "a", due_at: "2026-11-01", done_at: "2026-11-01" },
      { deal_id: "b", due_at: "2026-11-01", done_at: "2026-11-01" },
    ]);
    expect(m.get("a")).toBe("2026-11-18");
    expect(m.has("b")).toBe(false);
  });

  test("фильтр: поиск по имени, телефону, тегу; ответственный, клуб, без задач", () => {
    const deals = [
      deal({
        id: "1",
        contact: {
          id: "c",
          name: "Анна Иванова",
          phone: "+995 555 12 34 56",
          email: null,
          client_id: null,
        },
      }),
      deal({
        id: "2",
        title: "Пробное",
        tags: ["Instagram"],
        responsible_id: "u1",
        studio_id: "s",
      }),
    ];
    const none = new Map<string, string>();
    expect(filterDeals(deals, { ...EMPTY_FILTER, search: "иван" }, none).map((d) => d.id)).toEqual([
      "1",
    ]);
    expect(
      filterDeals(deals, { ...EMPTY_FILTER, search: "555 12" }, none).map((d) => d.id),
    ).toEqual(["1"]);
    expect(filterDeals(deals, { ...EMPTY_FILTER, search: "insta" }, none).map((d) => d.id)).toEqual(
      ["2"],
    );
    expect(
      filterDeals(deals, { ...EMPTY_FILTER, responsible: "none" }, none).map((d) => d.id),
    ).toEqual(["1"]);
    expect(
      filterDeals(deals, { ...EMPTY_FILTER, responsible: "u1" }, none).map((d) => d.id),
    ).toEqual(["2"]);
    expect(filterDeals(deals, { ...EMPTY_FILTER, studio: "s" }, none).map((d) => d.id)).toEqual([
      "2",
    ]);
    expect(filterDeals(deals, { ...EMPTY_FILTER, studio: "none" }, none).map((d) => d.id)).toEqual([
      "1",
    ]);
    expect(
      filterDeals(deals, { ...EMPTY_FILTER, noTasks: true }, new Map([["1", "x"]])).map(
        (d) => d.id,
      ),
    ).toEqual(["2"]);
  });

  test("колонки: недавно вошедшие в этап — первыми; сумма", () => {
    const g = groupByStage([
      deal({ id: "old", stage_entered_at: "2026-11-01T00:00:00Z", budget: 100 }),
      deal({ id: "new", stage_entered_at: "2026-11-10T00:00:00Z", budget: 50.5 }),
      deal({ id: "x", stage_id: "s2" }),
    ]);
    expect(g.get("s1")!.map((d) => d.id)).toEqual(["new", "old"]);
    expect(sumBudget(g.get("s1")!)).toBe(150.5);
    expect(sumBudget(g.get("s2")!)).toBe(0);
  });

  test("бюджет и теги из полей", () => {
    expect(parseBudget("")).toBeNull();
    expect(parseBudget(" 1 200,50 ")).toBe(1200.5);
    expect(parseBudget("abc")).toBeUndefined();
    expect(parseBudget("-5")).toBeUndefined();
    expect(parseTags(" #vip, Instagram ,, vip, VIP")).toEqual(["vip", "Instagram"]);
  });

  test("подписи событий", () => {
    expect(eventText({ kind: "created", body: null, meta: { stage: "Новое" } })).toBe(
      "Сделка создана в этапе «Новое»",
    );
    expect(
      eventText({ kind: "stage", body: null, meta: { from: "A", to: "B", reason: "Дорого" } }),
    ).toBe("Этап: «A» → «B». Причина: Дорого.");
    expect(eventText({ kind: "responsible", body: null, meta: { from: "Анна", to: null } })).toBe(
      "Ответственный снят (был Анна)",
    );
    expect(eventText({ kind: "task_done", body: "Позвонить", meta: {} })).toBe(
      "Задача выполнена: Позвонить",
    );
  });

  test("сколько в этапе", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(ageLabel("2026-11-17T11:58:00Z", now)).toBe("только что");
    expect(ageLabel("2026-11-17T11:30:00Z", now)).toBe("30 мин");
    expect(ageLabel("2026-11-17T07:00:00Z", now)).toBe("5 ч");
    expect(ageLabel("2026-11-14T07:00:00Z", now)).toBe("3 дн");
  });

  test("порядок после перетаскивания", () => {
    expect(reorderIds(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(reorderIds(["a", "b"], "a", "x", true)).toEqual(["a", "b"]);
  });

  test("подпись аккаунта и шаблон ответа", () => {
    expect(accountLabel({ kind: "telegram_bot", name: "Ваке" })).toBe("Telegram-бот · Ваке");
    expect(accountLabel({ kind: "telegram_bot", name: "Telegram-бот" })).toBe("Telegram-бот");
    expect(accountLabel(null)).toBe("Канал");
    expect(
      fillTemplate("Здравствуйте, {имя}! Ждём в {клуб}.", { name: "Анна Иванова", studio: "Ваке" }),
    ).toBe("Здравствуйте, Анна! Ждём в Ваке.");
    expect(fillTemplate("Здравствуйте, {имя} !", { name: null })).toBe("Здравствуйте!");
  });

  test("длительность и подпись правила", () => {
    expect(splitDuration(120)).toEqual({ value: 2, unit: "hours" });
    expect(splitDuration(90)).toEqual({ value: 90, unit: "minutes" });
    expect(splitDuration(2880)).toEqual({ value: 2, unit: "days" });
    expect(joinDuration(3, "days")).toBe(4320);
    expect(durationLabel(60)).toBe("1 час");
    expect(durationLabel(15)).toBe("15 минут");
    expect(durationLabel(7200)).toBe("5 дней");
    const names = {
      stage: () => "В работе",
      person: (id: string) => (id === "a" ? "Анна" : "Нино"),
    };
    expect(
      automationLabel(
        { trigger: "enter", delay_minutes: 0, action: "task", params: { title: "Позвонить" } },
        names,
      ),
    ).toBe("Сразу при входе в этап → задача «Позвонить»");
    expect(
      automationLabel(
        {
          trigger: "enter",
          delay_minutes: 0,
          action: "responsible",
          params: { user_ids: ["a", "b"] },
        },
        names,
      ),
    ).toBe("Сразу при входе в этап → ответственный по очереди: Анна, Нино");
    expect(
      automationLabel(
        { trigger: "no_reply", delay_minutes: 120, action: "move", params: { stage_id: "s" } },
        names,
      ),
    ).toBe("Клиент не ответил 2 часа → перевести в этап «В работе»");
    expect(
      automationLabel(
        { trigger: "attended", delay_minutes: 1440, action: "tag", params: { tag: "был" } },
        names,
      ),
    ).toBe("Клиент посетил занятие, через 1 день → тег #был");
    expect(
      automationLabel(
        { trigger: "inbound", delay_minutes: 0, action: "tag", params: { tag: "vip" } },
        names,
      ),
    ).toBe("Клиент написал → тег #vip");
  });

  test("отчёт: доля и ожидание ответа", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
    expect(waitLabel(null)).toBe("—");
    expect(waitLabel(0.4)).toBe("1 мин");
    expect(waitLabel(90)).toBe("1 ч 30 мин");
    expect(waitLabel(120)).toBe("2 ч");
    expect(waitLabel(4320)).toBe("3 дн");
  });
});
