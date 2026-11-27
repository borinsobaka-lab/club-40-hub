import { describe, expect, test } from "bun:test";

import {
  allChanges,
  changeFromPrevious,
  chartGroupsWithData,
  chartRows,
  metricChange,
  metricValue,
  signed,
  type DiagnosticPoint,
} from "./metrics";

function point(id: string, date: string, over: Partial<DiagnosticPoint> = {}): DiagnosticPoint {
  return {
    id,
    diagnostic_date: date,
    chest_cm: null,
    waist_cm: null,
    hips_cm: null,
    weight_kg: null,
    split_right_cm: null,
    split_left_cm: null,
    split_middle_cm: null,
    forward_bend: null,
    forward_bend_cm: null,
    emotional_level: null,
    activity_level: null,
    ...over,
  };
}

describe("диагностика: динамика", () => {
  // Нарочно не по порядку: сортирует сама логика.
  const list = [
    point("b", "2026-12-20", { waist_cm: 66, split_right_cm: 12, emotional_level: 8 }),
    point("a", "2026-10-01", {
      waist_cm: 70,
      split_right_cm: 20,
      emotional_level: 5,
      forward_bend: "До пола не достаёт",
      forward_bend_cm: 10,
    }),
    point("c", "2027-02-10", {
      waist_cm: 64.5,
      forward_bend: "Пальцы касаются пола",
      weight_kg: 61,
    }),
  ];

  test("изменение от первой к последней и «лучше / хуже»", () => {
    expect(metricChange(list, "waist_cm")).toMatchObject({ diff: -5.5, trend: "changed" });
    expect(metricChange(list, "split_right_cm")).toMatchObject({ diff: -8, trend: "better" });
    expect(metricChange(list, "emotional_level")).toMatchObject({ diff: 3, trend: "better" });
    // Вес — только в одной диагностике: изменения нет.
    expect(metricChange(list, "weight_kg")).toBeNull();
  });

  test("наклон: достаёт до пола — 0 см", () => {
    expect(metricValue(list[2], "bend_gap_cm")).toBe(0);
    expect(metricValue(list[1], "bend_gap_cm")).toBe(10);
    expect(metricValue(list[0], "bend_gap_cm")).toBeNull();
    expect(metricChange(list, "bend_gap_cm")).toMatchObject({ diff: -10, trend: "better" });
  });

  test("к предыдущей диагностике — по своему показателю", () => {
    expect(changeFromPrevious(list, "b", "waist_cm")).toEqual({ diff: -4, trend: "changed" });
    expect(changeFromPrevious(list, "a", "waist_cm")).toBeNull();
    // У «c» шпагата нет — сравнивать нечего.
    expect(changeFromPrevious(list, "c", "split_right_cm")).toBeNull();
  });

  test("графики — только где ≥ 2 значения; строки по датам", () => {
    const groups = chartGroupsWithData(list);
    expect(groups.map((g) => g.key)).toEqual(["volumes", "splits", "bend", "wellbeing"]);
    expect(groups[0].metrics).toEqual(["waist_cm"]);
    const rows = chartRows(list, ["split_right_cm"]);
    expect(rows.map((r) => [r.date, r.split_right_cm])).toEqual([
      ["2026-10-01", 20],
      ["2026-12-20", 12],
    ]);
    expect(allChanges(list).map((c) => c.key)).toEqual([
      "waist_cm",
      "split_right_cm",
      "bend_gap_cm",
      "emotional_level",
    ]);
  });

  test("одна диагностика — динамики нет", () => {
    expect(chartGroupsWithData([list[0]])).toEqual([]);
    expect(allChanges([list[0]])).toEqual([]);
  });

  test("знак изменения", () => {
    expect(signed(-4)).toBe("−4");
    expect(signed(1.5)).toBe("+1.5");
    expect(signed(0)).toBe("0");
  });
});
