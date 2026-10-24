import { describe, expect, test } from "bun:test";

import { documentHeadings, documentIsEmpty } from "./document";
import { formatFileSize } from "./files";

const text = (t: string) => [{ type: "text", text: t, styles: {} }];

describe("документ статьи", () => {
  test("оглавление — заголовки по порядку, и во вложенных блоках", () => {
    const doc = [
      { id: "h1", type: "heading", props: { level: 1 }, content: text("Открытие"), children: [] },
      {
        id: "p",
        type: "paragraph",
        content: text("текст"),
        children: [
          { id: "h2", type: "heading", props: { level: 2 }, content: text("Касса"), children: [] },
        ],
      },
      { id: "h3", type: "heading", props: { level: 3 }, content: [], children: [] },
    ];
    expect(documentHeadings(doc)).toEqual([
      { id: "h1", level: 1, text: "Открытие" },
      { id: "h2", level: 2, text: "Касса" },
    ]);
  });

  test("пустая статья — без текста и файлов", () => {
    expect(documentIsEmpty(null)).toBe(true);
    expect(documentIsEmpty([{ id: "a", type: "paragraph", content: [], children: [] }])).toBe(true);
    expect(
      documentIsEmpty([{ id: "a", type: "paragraph", content: text("x"), children: [] }]),
    ).toBe(false);
    expect(
      documentIsEmpty([
        { id: "a", type: "image", props: { url: "kbfile:a/b/c.png" }, children: [] },
      ]),
    ).toBe(false);
    expect(documentIsEmpty([{ id: "a", type: "divider", props: {}, children: [] }])).toBe(false);
  });
});

describe("размер файла", () => {
  test("по-человечески", () => {
    expect(formatFileSize(512)).toBe("512 Б");
    expect(formatFileSize(2048)).toBe("2 КБ");
    expect(formatFileSize(50 * 1024 * 1024)).toBe("50 МБ");
    expect(formatFileSize(12.4 * 1024 * 1024)).toBe("12,4 МБ");
  });
});
