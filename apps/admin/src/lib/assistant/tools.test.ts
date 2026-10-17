import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, studioDayStart, studioToday } from "./dates";
import { createAssistantTools } from "./tools.server";

type FakeResult = { data: unknown; error: { message: string } | null };

/**
 * Поддельный клиент: записывает цепочку вызовов и отвечает заданным
 * результатом (или своим для каждой таблицы).
 */
function fakeSupabase(result: FakeResult | ((table: string) => FakeResult)) {
  const calls: string[] = [];
  const builder = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            const r = typeof result === "function" ? result(table) : result;
            return (resolve: (v: unknown) => void) => resolve({ ...r, count: 0 });
          }
          return (...args: unknown[]) => {
            calls.push(`${table}.${prop}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
            return builder(table);
          };
        },
      },
    );
  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient;
  return { client, calls };
}

const run = async (
  tools: ReturnType<typeof createAssistantTools>,
  name: keyof ReturnType<typeof createAssistantTools>,
  input: unknown,
) => {
  const t = tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return t.execute(input, { toolCallId: "t1", messages: [] });
};

describe("даты студии", () => {
  test("сегодня — по Тбилиси, а не по UTC", () => {
    // 22:30 UTC 9 октября = 02:30 10 октября в Тбилиси.
    expect(studioToday(new Date("2026-10-09T22:30:00Z"))).toBe("2026-10-10");
  });
  test("addDays переходит через месяц", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("начало суток с поясом студии", () => {
    expect(studioDayStart("2026-10-09")).toBe("2026-10-09T00:00:00+04:00");
  });
});

describe("инструменты Kate", () => {
  test("история записей фильтрует по starts_at, «по» включительно", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await run(createAssistantTools(client, "s1"), "list_bookings_log", {
      from: "2026-10-01",
      to: "2026-10-09",
      limit: 10,
    });
    expect(calls).toContain('bookings_log.gte("starts_at", "2026-10-01T00:00:00+04:00")');
    expect(calls).toContain('bookings_log.lt("starts_at", "2026-10-10T00:00:00+04:00")');
    expect(calls.some((c) => c.includes("created_at"))).toBe(false);
  });

  test("отзывы — только своей студии или без студии", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await run(createAssistantTools(client, "s1"), "list_feedback", { limit: 10 });
    expect(calls).toContain('feedback.or("studio_id.eq.s1,studio_id.is.null")');
  });

  test("ошибка базы возвращается как error, а не как пустой список", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    const res = await run(createAssistantTools(client, "s1"), "list_sales", { limit: 10 });
    expect(res).toEqual({ error: "boom" });
  });

  test("сумма продаж считается по строкам", async () => {
    const { client } = fakeSupabase({
      data: [{ total_amount: 100 }, { total_amount: "50.5" }, { total_amount: null }],
      error: null,
    });
    const res = (await run(createAssistantTools(client, "s1"), "list_sales", {
      limit: 10,
    })) as { count: number; total_amount: number };
    expect(res.count).toBe(3);
    expect(res.total_amount).toBe(150.5);
  });

  test("клиенты пакетного клуба — общей базы всех пакетных клубов, подписочного — только его", async () => {
    const studios = [
      { id: "p1", format: "packages" },
      { id: "s1", format: "subscription" },
      { id: "p2", format: "packages" },
    ];
    const answer = (table: string) => ({ data: table === "studios" ? studios : [], error: null });
    const pack = fakeSupabase(answer);
    await run(createAssistantTools(pack.client, "p2"), "list_clients", { limit: 10 });
    expect(pack.calls).toContain('clients.in("studio_id", ["p1","p2"])');
    const sub = fakeSupabase(answer);
    await run(createAssistantTools(sub.client, "s1"), "list_clients", { limit: 10 });
    expect(sub.calls).toContain('clients.in("studio_id", ["s1"])');
  });

  test("сводка не выдаёт ошибку запроса за ноль", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "denied" } });
    const res = (await run(createAssistantTools(client, "s1"), "counts_overview", {})) as Record<
      string,
      unknown
    >;
    expect(res.clients).toBeNull();
    expect(res.errors).toBeDefined();
  });
});
