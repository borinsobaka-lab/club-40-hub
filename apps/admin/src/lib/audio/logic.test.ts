import { describe, expect, test } from "bun:test";

import {
  aaErrorText,
  clockTime,
  compareVersions,
  dayActions,
  deltaCost,
  deltaCount,
  deltaPoints,
  deltaScore,
  formatCost,
  formatDuration,
  formatOffset,
  formatSize,
  isInFlight,
  isStale,
  matchPreset,
  metricChipText,
  metricStats,
  presetPeriod,
  previousPeriod,
  scoreTone,
  splitCues,
  statusView,
  workerAlive,
} from "./logic";

describe("время на часах студии", () => {
  test("начало смены плюс смещение — по Тбилиси (UTC+4)", () => {
    expect(clockTime("2026-10-30T06:00:00Z", 0)).toBe("10:00");
    expect(clockTime("2026-10-30T06:00:00Z", 3600 + 30 * 60)).toBe("11:30");
  });
  test("через полночь и другой часовой пояс", () => {
    expect(clockTime("2026-10-30T19:50:00Z", 20 * 60)).toBe("00:10");
    expect(clockTime("2026-10-30T06:00:00Z", 0, "Europe/Moscow")).toBe("09:00");
  });
  test("неизвестный пояс — Тбилиси, пустое начало — пусто", () => {
    expect(clockTime("2026-10-30T06:00:00Z", 0, "Mars/Base")).toBe("10:00");
    expect(clockTime(null, 10)).toBe("");
    expect(clockTime("не дата", 10)).toBe("");
  });
});

describe("длительности и деньги", () => {
  test("смещение в записи", () => {
    expect(formatOffset(65)).toBe("01:05");
    expect(formatOffset(3725.9)).toBe("1:02:05");
    expect(formatOffset(null)).toBe("—");
  });
  test("длительность словами", () => {
    expect(formatDuration(40)).toBe("40 с");
    expect(formatDuration(12 * 60)).toBe("12 мин");
    expect(formatDuration(5 * 3600 + 12 * 60)).toBe("5 ч 12 мин");
    expect(formatDuration(2 * 3600)).toBe("2 ч");
    expect(formatDuration(undefined)).toBe("—");
  });
  test("стоимость — доллары, три знака", () => {
    expect(formatCost(0.12345)).toBe("$0.123");
    expect(formatCost(2)).toBe("$2.000");
    expect(formatCost(null)).toBe("—");
  });
  test("размер файла", () => {
    expect(formatSize(0)).toBe("—");
    expect(formatSize(500)).toBe("1 КБ");
    expect(formatSize(12.3 * 1024 * 1024)).toBe("12,3 МБ");
  });
});

describe("метки времени в тексте разбора", () => {
  test("[ЧЧ:ММ:СС] и [ММ:СС] — отдельными кусками с секундами", () => {
    const parts = splitCues("[01:02:03] Встреча — «Здравствуйте» и [05:10] ещё");
    expect(parts).toEqual([
      { cue: "01:02:03", seconds: 3723 },
      { text: " Встреча — «Здравствуйте» и " },
      { cue: "05:10", seconds: 310 },
      { text: " ещё" },
    ]);
  });
  test("без меток — один кусок", () => {
    expect(splitCues("просто текст")).toEqual([{ text: "просто текст" }]);
  });
});

describe("статусы смены и действия", () => {
  test("подписи статусов", () => {
    expect(statusView("uploaded", false).label).toBe("Ждёт разбора");
    expect(statusView("processing", false).label).toBe("Разбирается");
    expect(statusView("done", false).tone).toBe("positive");
    expect(statusView("processing", true).label).toBe("Разбор завис");
  });
  test("зависший разбор — 3 часа без движения", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    expect(isStale("processing", "2026-10-30T08:00:00Z", now)).toBe(true);
    expect(isStale("queued", "2026-10-30T10:00:00Z", now)).toBe(false);
    expect(isStale("done", "2026-10-29T10:00:00Z", now)).toBe(false);
  });
  test("список обновляется, пока разбор идёт", () => {
    expect(isInFlight({ status: "queued", stale: false })).toBe(true);
    expect(isInFlight({ status: "processing", stale: true })).toBe(false);
    expect(isInFlight({ status: "uploaded", stale: false })).toBe(false);
  });
  test("действия по статусу", () => {
    expect(dayActions("uploaded", false)).toMatchObject({ process: "process", recalc: false });
    expect(dayActions("done", false)).toMatchObject({ process: null, recalc: true, full: true });
    expect(dayActions("error", false)).toMatchObject({ process: "restart", full: true });
    expect(dayActions("recording", false)).toMatchObject({ forceFinish: true, remove: true });
    expect(dayActions("processing", false).remove).toBe(false);
    expect(dayActions("processing", true)).toMatchObject({ process: "restart", remove: true });
  });
});

describe("метрики", () => {
  test("чип смены", () => {
    expect(
      metricChipText({ name: "Качество продажи", triggered: 4, avg: 7.2, scale_max: 10 }),
    ).toBe("Качество продажи: 4 · ★ 7.2/10");
    expect(metricChipText({ name: "Встреча", triggered: 0, avg: null, scale_max: 5 })).toBe(
      "Встреча: 0",
    );
  });
  test("цвет оценки по шкале", () => {
    expect(scoreTone(8, 10)).toBe("positive");
    expect(scoreTone(3, 5)).toBe("warning");
    expect(scoreTone(2, 10)).toBe("negative");
    expect(scoreTone(null, 10)).toBe("neutral");
  });
  test("среднее за смену — только сработавшие, порядок метрик", () => {
    const base = { metric_name: "", scale_max: 10 };
    const stats = metricStats([
      { ...base, metric_id: "b", metric_name: "Б", position: 2, applicable: true, score: 6 },
      { ...base, metric_id: "a", metric_name: "А", position: 1, applicable: true, score: 8 },
      { ...base, metric_id: "a", metric_name: "А", position: 1, applicable: true, score: 7 },
      { ...base, metric_id: "a", metric_name: "А", position: 1, applicable: false, score: null },
    ]);
    expect(stats.map((s) => [s.metric_id, s.triggered, s.avg])).toEqual([
      ["a", 2, 7.5],
      ["b", 1, 6],
    ]);
  });
});

describe("периоды дашборда", () => {
  const today = "2026-10-30";
  test("готовые периоды", () => {
    expect(presetPeriod("7", today)).toEqual({ from: "2026-10-24", to: today });
    expect(presetPeriod("30", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetPeriod("month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetPeriod("prev-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  test("узнаём готовый период по датам", () => {
    expect(matchPreset({ from: "2026-10-24", to: today }, today)).toBe("7");
    expect(matchPreset({ from: "2026-10-02", to: today }, today)).toBeNull();
  });
  test("прошлый период той же длины", () => {
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-30" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-07" })).toEqual({
      from: "2026-02-22",
      to: "2026-02-28",
    });
  });
});

describe("сравнение с прошлым периодом", () => {
  test("счётчики", () => {
    expect(deltaCount(12, 10)).toEqual({ text: "+2", good: true });
    expect(deltaCount(8, 10)).toEqual({ text: "−2", good: false });
    expect(deltaCount(5, 0)).toBeNull();
    expect(deltaCount(5, 5)?.text).toBe("без изменений");
  });
  test("конверсия — в процентных пунктах", () => {
    expect(deltaPoints(0.25, 0.2)).toEqual({ text: "+5 п. п.", good: true });
    expect(deltaPoints(null, 0.2)).toBeNull();
  });
  test("оценка", () => {
    expect(deltaScore(7.2, 6.9)).toEqual({ text: "+0.3", good: true });
    expect(deltaScore(6, 7)).toEqual({ text: "−1.0", good: false });
  });
  test("рост расходов — плохо", () => {
    expect(deltaCost(1.5, 1)).toEqual({ text: "+$0.500", good: false });
    expect(deltaCost(0.5, 1)?.good).toBe(true);
  });
});

describe("приложение", () => {
  test("версии сравниваются по числам", () => {
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.1", "1.0.0")).toBe(-1);
  });
  test("воркер жив, если отзывался последние 2 минуты", () => {
    expect(workerAlive(30)).toBe(true);
    expect(workerAlive(300)).toBe(false);
    expect(workerAlive(null)).toBe(false);
  });
});

describe("ошибки базы", () => {
  test("русское пояснение из hint — в первую очередь", () => {
    expect(aaErrorText("aa_busy", "Смена уже в очереди на разбор")).toBe(
      "Смена уже в очереди на разбор",
    );
  });
  test("коды без пояснения и нарушения", () => {
    expect(aaErrorText("aa_not_found")).toBe("Не найдено — возможно, уже удалено");
    expect(aaErrorText("permission denied for table aa_metrics", null, "42501")).toContain(
      "Нет прав",
    );
    expect(
      aaErrorText(
        'duplicate key value violates unique constraint "aa_locations_name_uidx"',
        null,
        "23505",
      ),
    ).toBe("Точка с таким названием уже есть");
    expect(aaErrorText("что-то другое")).toBe("что-то другое");
  });
});
