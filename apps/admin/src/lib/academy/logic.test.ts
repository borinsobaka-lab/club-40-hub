import { describe, expect, test } from "bun:test";

import {
  acadError,
  answerGiven,
  assignmentDueText,
  dueLabel,
  learnersCount,
  plural,
  progressPercent,
  questionError,
  quizzesToRecheck,
  staleLessons,
  unanswered,
} from "./logic";
import type { AcadAssignment, AcadQuizQuestion, AcadStaffPerson, AcadStep } from "./types";

const opt = (text: string, correct = false) => ({ id: text, text, correct });

describe("вопрос в форме", () => {
  test("как проверит база", () => {
    expect(questionError({ kind: "open", text: "  ", options: [] })).toBe("Напишите вопрос");
    expect(questionError({ kind: "open", text: "Расскажите", options: [] })).toBeNull();
    expect(questionError({ kind: "single", text: "?", options: [opt("a", true)] })).toBe(
      "Нужно хотя бы два варианта",
    );
    expect(questionError({ kind: "single", text: "?", options: [opt("a"), opt("")] })).toBe(
      "Заполните все варианты или удалите пустые",
    );
    expect(
      questionError({ kind: "single", text: "?", options: [opt("a", true), opt("b", true)] }),
    ).toBe("Отметьте один верный вариант");
    expect(questionError({ kind: "multiple", text: "?", options: [opt("a"), opt("b")] })).toBe(
      "Отметьте хотя бы один верный вариант",
    );
    expect(
      questionError({ kind: "multiple", text: "?", options: [opt("a", true), opt("b", true)] }),
    ).toBeNull();
  });
});

describe("ответы ученика", () => {
  const q = (kind: AcadQuizQuestion["kind"]): AcadQuizQuestion => ({
    id: kind,
    kind,
    text: "?",
    points: 1,
    allow_file: kind === "open",
    options: [],
  });
  test("ответ дан", () => {
    expect(answerGiven(q("single"), { question_id: "single", options: ["a", "b"] })).toBe(false);
    expect(answerGiven(q("single"), { question_id: "single", options: ["a"] })).toBe(true);
    expect(answerGiven(q("multiple"), { question_id: "multiple", options: [] })).toBe(false);
    expect(answerGiven(q("open"), { question_id: "open", text: " " })).toBe(false);
    expect(answerGiven(q("open"), { question_id: "open", file: "kbfile:x" })).toBe(true);
    expect(
      unanswered([q("single"), q("open")], { single: { question_id: "single", options: ["a"] } }),
    ).toBe(1);
  });
});

describe("сроки и слова", () => {
  test("срок прохождения", () => {
    expect(dueLabel(null, "2026-10-25")).toBeNull();
    expect(dueLabel("2026-11-02", "2026-10-25")).toEqual({ text: "До 02.11.2026", overdue: false });
    expect(dueLabel("2026-10-25", "2026-10-25")).toEqual({
      text: "Сегодня последний день",
      overdue: false,
    });
    expect(dueLabel("2026-10-22", "2026-10-25")).toEqual({
      text: "Просрочен на 3 дня",
      overdue: true,
    });
  });
  test("формы слов и проценты", () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, ["урок", "урока", "уроков"]))).toEqual([
      "урок",
      "урока",
      "уроков",
      "уроков",
      "урок",
      "урока",
    ]);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(0, 0)).toBe(0);
    expect(assignmentDueText({ due_date: "2026-12-01", due_days: null })).toBe("до 01.12.2026");
    expect(assignmentDueText({ due_date: null, due_days: 14 })).toBe("14 дней с назначения");
    expect(assignmentDueText({ due_date: null, due_days: null })).toBe("без срока");
  });
  test("ошибки базы — по-человечески", () => {
    expect(acadError(new Error("PostgresError: acad_locked"))).toBe(
      "Сначала пройдите предыдущие шаги курса",
    );
    expect(acadError(new Error("сеть"))).toBe("сеть");
  });
});

describe("напоминания конструктора", () => {
  const step = (id: string, kind: AcadStep["kind"], extra: Partial<AcadStep> = {}): AcadStep => ({
    id,
    course_id: "c",
    kind,
    title: id,
    sort_order: null,
    source_node_id: null,
    source_published_at: null,
    pass_percent: null,
    content_updated_at: null,
    questions_updated_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...extra,
  });

  test("статья опубликована заново после копии", () => {
    const steps = [
      step("l1", "lesson", { source_node_id: "n1", source_published_at: "2026-10-10T00:00:00Z" }),
      step("l2", "lesson", { source_node_id: "n2", source_published_at: "2026-10-10T00:00:00Z" }),
    ];
    const sources = [
      {
        step_id: "l1",
        node_id: "n1",
        base_id: "b",
        node_title: "",
        published_at: "2026-10-20T00:00:00Z",
        available: true,
      },
      {
        step_id: "l2",
        node_id: "n2",
        base_id: "b",
        node_title: "",
        published_at: "2026-10-10T00:00:00Z",
        available: true,
      },
    ];
    expect([...staleLessons(steps, sources)]).toEqual(["l1"]);
  });

  test("урок изменился после правки вопросов теста за ним", () => {
    const steps = [
      step("урок 1", "lesson", { content_updated_at: "2026-10-20T00:00:00Z" }),
      step("тест 1", "quiz", { questions_updated_at: "2026-10-15T00:00:00Z" }),
      step("урок 2", "lesson", { content_updated_at: "2026-10-01T00:00:00Z" }),
      step("тест 2", "quiz", { questions_updated_at: "2026-10-15T00:00:00Z" }),
      step("тест 3", "quiz", { questions_updated_at: null }),
    ];
    const recheck = quizzesToRecheck(steps, { "тест 1": 3, "тест 2": 2, "тест 3": 0 });
    expect([...recheck]).toEqual([["тест 1", ["урок 1"]]]);
  });

  test("сколько людей получат курс", () => {
    const people: AcadStaffPerson[] = [
      {
        user_id: "a",
        full_name: "А",
        avatar_url: null,
        email: null,
        roles: [{ role: "admin", studio_id: "s1" }],
      },
      {
        user_id: "b",
        full_name: "Б",
        avatar_url: null,
        email: null,
        roles: [{ role: "trainer", studio_id: "s2" }],
      },
      {
        user_id: "c",
        full_name: "В",
        avatar_url: null,
        email: null,
        roles: [{ role: "trainer", studio_id: "s1" }],
      },
    ];
    const base = { id: "x", course_id: "c", due_date: null, due_days: null, created_at: "" };
    const assignments: AcadAssignment[] = [
      { ...base, subject_type: "role", role: "trainer", studio_ids: ["s2"], user_id: null },
      { ...base, subject_type: "user", user_id: "a", role: null, studio_ids: [] },
    ];
    expect(learnersCount(people, assignments)).toBe(2);
  });
});
