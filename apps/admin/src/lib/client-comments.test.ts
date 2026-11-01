import { describe, expect, test } from "bun:test";

import {
  canEditComment,
  commentAgeDays,
  commentAuthor,
  commentsCountText,
  commentWhen,
  saleLabel,
  saleState,
  type CommentSale,
} from "./client-comments";

const now = new Date(2026, 10, 1, 15, 0); // 1 ноября 2026, 15:00 локально

describe("комментарии клиента — подписи", () => {
  test("когда: сегодня, вчера, в этом году, раньше; перенесённый — без даты", () => {
    expect(commentWhen(new Date(2026, 10, 1, 9, 5).toISOString(), "note", now)).toBe(
      "сегодня 09:05",
    );
    expect(commentWhen(new Date(2026, 9, 31, 23, 40).toISOString(), "note", now)).toBe(
      "вчера 23:40",
    );
    expect(commentWhen(new Date(2026, 9, 12, 10).toISOString(), "note", now)).toBe("12 окт");
    expect(commentWhen(new Date(2025, 9, 12, 10).toISOString(), "note", now)).toBe("12.10.2025");
    expect(commentWhen(new Date(2026, 9, 12).toISOString(), "imported", now)).toBe("без даты");
  });

  test("свежесть — дни назад, у перенесённого её нет", () => {
    expect(commentAgeDays(new Date(2026, 10, 1, 1).toISOString(), "note", now)).toBe(0);
    expect(commentAgeDays(new Date(2026, 9, 29, 20).toISOString(), "sale", now)).toBe(3);
    expect(commentAgeDays(new Date(2026, 9, 29).toISOString(), "imported", now)).toBeNull();
  });

  test("склонение", () => {
    expect(commentsCountText(1)).toBe("1 комментарий");
    expect(commentsCountText(3)).toBe("3 комментария");
    expect(commentsCountText(5)).toBe("5 комментариев");
    expect(commentsCountText(11)).toBe("11 комментариев");
    expect(commentsCountText(22)).toBe("22 комментария");
  });

  test("автор и право правки", () => {
    expect(commentAuthor({ author_name: " Анна ", kind: "note" })).toBe("Анна");
    expect(commentAuthor({ author_name: null, kind: "imported" })).toBe("Прежний комментарий");
    expect(commentAuthor({ author_name: null, kind: "sale" })).toBe("Без автора");
    expect(canEditComment({ author_id: "me" }, "me")).toBe(true);
    expect(canEditComment({ author_id: "other" }, "me")).toBe(false);
    expect(canEditComment({ author_id: null }, "me")).toBe(true);
    expect(canEditComment({ author_id: "me" }, null)).toBe(false);
  });

  test("абонемент: подпись и текущий / прошлый", () => {
    const sale = (cm: CommentSale["client_memberships"]): CommentSale => ({
      id: "s",
      sold_at: "2026-10-12",
      memberships: { name: "Пакет 8" },
      client_memberships: cm,
    });
    const cm = (status: string, ends_at: string | null = null) => ({
      status,
      ends_at,
      started_at: "2026-10-12",
      starts_on_first_visit: false,
    });
    expect(saleLabel(sale(null))).toBe("Пакет 8 от 12.10.2026");
    expect(saleState(sale([cm("active", "2026-11-30")]), "2026-11-01")).toBe("current");
    expect(saleState(sale([cm("active", "2026-10-30")]), "2026-11-01")).toBe("past");
    expect(saleState(sale([cm("frozen")]), "2026-11-01")).toBe("current");
    expect(saleState(sale([cm("pending")]), "2026-11-01")).toBe("current");
    expect(saleState(sale([cm("replaced")]), "2026-11-01")).toBe("past");
    expect(saleState(sale([]), "2026-11-01")).toBe("past");
  });
});
