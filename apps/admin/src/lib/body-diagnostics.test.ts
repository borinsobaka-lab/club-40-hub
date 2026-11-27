import { describe, expect, test } from "bun:test";

import {
  bendText,
  diffText,
  dynamicsTable,
  recFocusText,
  type BodyDiagnosticRow,
} from "./body-diagnostics";

function row(id: string, date: string, over: Partial<BodyDiagnosticRow> = {}): BodyDiagnosticRow {
  return {
    id,
    diagnostic_date: date,
    studio_id: null,
    trainer_name: null,
    trainer: null,
    studio: null,
    birth_date: null,
    activity_level: null,
    emotional_level: null,
    emotional_comment: null,
    directions: [],
    no_restrictions: false,
    restrictions: [],
    restrictions_other: null,
    goals: [],
    priority_today: null,
    measure_skipped: false,
    chest_cm: null,
    waist_cm: null,
    hips_cm: null,
    weight_kg: null,
    balance_test: null,
    balance_comment: null,
    forward_bend: null,
    forward_bend_cm: null,
    forward_bend_comment: null,
    split_right_cm: null,
    split_left_cm: null,
    split_middle_cm: null,
    photo_paths: [],
    stage: null,
    rec_trainings: null,
    rec_directions: [],
    rec_focus: null,
    updated_at: "",
    ...over,
  };
}

describe("диагностика тела в карточке клиента", () => {
  test("таблица динамики: по датам, только измеренные, изменение и «лучше»", () => {
    const { dates, rows } = dynamicsTable([
      row("b", "2026-11-20", {
        waist_cm: "66",
        split_right_cm: 15,
        forward_bend: "Ладони на полу",
      }),
      row("a", "2026-08-20", {
        waist_cm: "70.5",
        split_right_cm: 30,
        forward_bend: "До пола не достаёт",
        forward_bend_cm: 12,
        weight_kg: 64,
      }),
    ]);
    expect(dates).toEqual(["2026-08-20", "2026-11-20"]);
    expect(rows.map((r) => r.key)).toEqual([
      "waist_cm",
      "weight_kg",
      "split_right_cm",
      "bend_gap_cm",
    ]);
    expect(rows[0]).toMatchObject({ values: [70.5, 66], diff: -4.5, trend: "changed" });
    expect(rows[1]).toMatchObject({ values: [64, null], diff: null, trend: null });
    expect(rows[2]).toMatchObject({ diff: -15, trend: "better" });
    expect(rows[3]).toMatchObject({ values: [12, 0], trend: "better" });
  });

  test("подписи", () => {
    expect(diffText(-4.5, "см")).toBe("−4,5 см");
    expect(diffText(2, "из 10")).toBe("+2");
    expect(diffText(0, "кг")).toBe("без изменений");
    expect(bendText({ forward_bend: "До пола не достаёт", forward_bend_cm: "8" })).toBe(
      "8 см до пола",
    );
    expect(bendText({ forward_bend: "Пальцы касаются пола", forward_bend_cm: null })).toBe(
      "Пальцы касаются пола",
    );
    expect(recFocusText({ rec_focus: null, rec_directions: ["Pilates", "Yoga"] })).toBe(
      "Рекомендую вам направления: Pilates, Yoga.",
    );
    expect(recFocusText({ rec_focus: " Свой текст ", rec_directions: ["Yoga"] })).toBe(
      "Свой текст",
    );
  });
});
