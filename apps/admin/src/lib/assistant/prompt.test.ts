import { describe, expect, test } from "bun:test";

import { buildSystemPrompt } from "./prompt";

describe("промпт Kate", () => {
  test("дата с днём недели, клуб и формат", () => {
    const p = buildSystemPrompt({
      today: "2026-10-19",
      studio: { name: "Lady Stretch Ваке" },
      staffName: "Иванова Анна",
    });
    expect(p).toContain("Сегодня 2026-10-19, понедельник");
    expect(p).toContain("«Lady Stretch Ваке»");
    expect(p).toContain("пакетами тренировок");
    expect(p).toContain("list_client_requests");
    expect(p).toContain("Иванова Анна");
    expect(p).toContain("(client:<client_id>)");
  });

  test("без подписочного словаря", () => {
    const p = buildSystemPrompt({ today: "2026-10-19", studio: { name: null } });
    expect(p).not.toContain("подписочной");
    expect(p).not.toContain("автопродление");
  });
});
