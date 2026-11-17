import { describe, expect, test } from "bun:test";

import { attachmentKind, isBotToken, parseTelegramUpdate, safeFileName } from "./telegram";

const base = {
  message_id: 7,
  date: 1_763_380_000,
  chat: { id: 555, type: "private" },
  from: { id: 555, is_bot: false, username: "anna", first_name: "Анна", last_name: "И." },
};

describe("Telegram-бот: разбор входящего", () => {
  test("текст личного сообщения", () => {
    const m = parseTelegramUpdate({ update_id: 1, message: { ...base, text: "Привет" } })!;
    expect(m.chatId).toBe("555");
    expect(m.sender).toEqual({
      external_id: "555",
      username: "anna",
      name: "Анна И.",
      phone: null,
    });
    expect(m.message.external_id).toBe("7");
    expect(m.message.body).toBe("Привет");
    expect(m.message.sent_at).toBe(new Date(1_763_380_000_000).toISOString());
    expect(m.files).toEqual([]);
  });

  test("группы, боты, правки и пустое — пропускаем", () => {
    expect(
      parseTelegramUpdate({ message: { ...base, text: "x", chat: { id: -1, type: "group" } } }),
    ).toBeNull();
    expect(
      parseTelegramUpdate({
        message: { ...base, text: "x", from: { ...base.from, is_bot: true } },
      }),
    ).toBeNull();
    expect(parseTelegramUpdate({ edited_message: { ...base, text: "x" } })).toBeNull();
    expect(parseTelegramUpdate({ message: { ...base } })).toBeNull();
    expect(parseTelegramUpdate(null)).toBeNull();
  });

  test("фото — самый большой размер, подпись — текстом; документ с именем", () => {
    const photo = parseTelegramUpdate({
      message: {
        ...base,
        caption: "Вот",
        photo: [{ file_id: "s" }, { file_id: "big", file_size: 9 }],
      },
    })!;
    expect(photo.message.body).toBe("Вот");
    expect(photo.files).toEqual([
      { fileId: "big", kind: "image", name: "image-7.jpg", mime: null, size: 9 },
    ]);
    const doc = parseTelegramUpdate({
      message: {
        ...base,
        document: { file_id: "d", file_name: "договор.pdf", mime_type: "application/pdf" },
      },
    })!;
    expect(doc.message.body).toBeNull();
    expect(doc.files[0]).toMatchObject({
      kind: "file",
      name: "договор.pdf",
      mime: "application/pdf",
    });
    const voice = parseTelegramUpdate({ message: { ...base, voice: { file_id: "v" } } })!;
    expect(voice.files[0].kind).toBe("audio");
  });

  test("телефон — только свой контакт", () => {
    const own = parseTelegramUpdate({
      message: { ...base, contact: { phone_number: "995555123456", user_id: 555 } },
    })!;
    expect(own.sender.phone).toBe("+995555123456");
    expect(own.message.body).toBe("[контакт: 995555123456]");
    const other = parseTelegramUpdate({
      message: { ...base, contact: { phone_number: "995555000000", user_id: 9 } },
    })!;
    expect(other.sender.phone).toBeNull();
  });

  test("токен бота, имя файла, вид вложения", () => {
    expect(isBotToken("123456789:AAHk3-abcdefghijklmnopqrstuvwxyz_012345")).toBe(true);
    expect(isBotToken("abc")).toBe(false);
    expect(safeFileName("../../etc/пароль?.txt")).toBe(".._.._etc_пароль_.txt");
    expect(safeFileName("///")).toBe("___");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("file");
    expect(attachmentKind(null)).toBe("file");
  });
});
