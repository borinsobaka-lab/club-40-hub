import { describe, expect, test } from "bun:test";

import { needsHumanAgentTag, parseMetaWebhook, replyWindowOpen } from "./meta";

describe("вебхук Meta: разбор", () => {
  test("WhatsApp: текст, документ, статусы", () => {
    const { messages, statuses } = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "995555000000", phone_number_id: "PN1" },
                contacts: [{ profile: { name: "Нино" }, wa_id: "995555123456" }],
                messages: [
                  {
                    from: "995555123456",
                    id: "wamid.A",
                    timestamp: "1763380000",
                    type: "text",
                    text: { body: "Привет" },
                  },
                  {
                    from: "995555123456",
                    id: "wamid.B",
                    timestamp: "1763380100",
                    type: "document",
                    document: {
                      id: "M1",
                      mime_type: "application/pdf",
                      filename: "чек.pdf",
                      caption: "оплата",
                    },
                  },
                  {
                    from: "995555123456",
                    id: "wamid.C",
                    timestamp: "1",
                    type: "reaction",
                    reaction: {},
                  },
                ],
                statuses: [
                  { id: "wamid.OUT", status: "delivered", timestamp: "1" },
                  {
                    id: "wamid.F",
                    status: "failed",
                    errors: [{ code: 131047, title: "Re-engagement message" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(messages.length).toBe(2);
    expect(messages[0]).toMatchObject({
      kind: "whatsapp",
      accountExternalId: "PN1",
      chatId: "995555123456",
      sender: { external_id: "995555123456", name: "Нино", phone: "+995555123456" },
      message: {
        external_id: "wamid.A",
        body: "Привет",
        sent_at: new Date(1763380000_000).toISOString(),
      },
    });
    expect(messages[1].message.body).toBe("оплата");
    expect(messages[1].files).toEqual([
      {
        mediaId: "M1",
        url: null,
        kind: "file",
        name: "чек.pdf",
        mime: "application/pdf",
        size: null,
      },
    ]);
    expect(statuses).toEqual([
      { externalId: "wamid.OUT", status: "delivered", error: null },
      { externalId: "wamid.F", status: "failed", error: "131047: Re-engagement message" },
    ]);
  });

  test("Messenger и Instagram: сообщение, вложение, эхо пропускается", () => {
    const fb = parseMetaWebhook({
      object: "page",
      entry: [
        {
          id: "PAGE",
          messaging: [
            {
              sender: { id: "PSID" },
              recipient: { id: "PAGE" },
              timestamp: 1763380000000,
              message: { mid: "mid.1", text: "Здравствуйте" },
            },
            {
              sender: { id: "PAGE" },
              recipient: { id: "PSID" },
              timestamp: 1,
              message: { mid: "mid.2", text: "эхо", is_echo: true },
            },
            {
              sender: { id: "PSID" },
              recipient: { id: "PAGE" },
              timestamp: 2,
              read: { watermark: 1 },
            },
          ],
        },
      ],
    });
    expect(fb.messages.length).toBe(1);
    expect(fb.messages[0]).toMatchObject({
      kind: "facebook",
      accountExternalId: "PAGE",
      chatId: "PSID",
    });
    expect(fb.messages[0].message.sent_at).toBe(new Date(1763380000000).toISOString());

    const ig = parseMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: "IG",
          messaging: [
            {
              sender: { id: "IGSID" },
              recipient: { id: "IG" },
              timestamp: 1763380000000,
              message: {
                mid: "m.9",
                attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }],
              },
            },
          ],
        },
      ],
    });
    expect(ig.messages[0]).toMatchObject({
      kind: "instagram",
      accountExternalId: "IG",
      chatId: "IGSID",
    });
    expect(ig.messages[0].message.body).toBeNull();
    expect(ig.messages[0].files[0]).toMatchObject({
      url: "https://cdn/x.jpg",
      kind: "image",
      mediaId: null,
    });
  });

  test("мусор не роняет разбор", () => {
    expect(parseMetaWebhook(null)).toEqual({ messages: [], statuses: [], templates: [] });
    expect(
      parseMetaWebhook({ object: "page", entry: [{ id: "P", messaging: "x" }] }).messages,
    ).toEqual([]);
    expect(parseMetaWebhook({ object: "user", entry: [{ id: "1" }] }).messages).toEqual([]);
  });

  test("окно ответа 24 часа", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(replyWindowOpen("telegram_bot", null, now)).toBe(true);
    expect(replyWindowOpen("whatsapp", "2026-11-17T00:00:00Z", now)).toBe(true);
    expect(replyWindowOpen("whatsapp", "2026-11-16T11:59:00Z", now)).toBe(false);
    expect(replyWindowOpen("instagram", "2026-11-16T11:59:00Z", now)).toBe(true);
    expect(needsHumanAgentTag("instagram", "2026-11-16T11:59:00Z", now)).toBe(true);
    expect(needsHumanAgentTag("instagram", "2026-11-17T11:00:00Z", now)).toBe(false);
    expect(needsHumanAgentTag("whatsapp", null, now)).toBe(false);
    expect(replyWindowOpen("instagram", "2026-11-09T11:59:00Z", now)).toBe(false);
    expect(replyWindowOpen("facebook", null, now)).toBe(false);
  });

  test("статус шаблона WhatsApp", () => {
    const { templates } = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_id: 123,
                reason: "INVALID_FORMAT",
                rejection_info: { reason: "r", recommendation: "Уберите переменную в начале" },
              },
            },
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_id: 5, reason: "NONE" },
            },
            {
              field: "message_template_status_update",
              value: { event: "REINSTATED", message_template_id: 6 },
            },
          ],
        },
      ],
    });
    expect(templates).toEqual([
      { metaId: "123", status: "REJECTED", reason: "INVALID_FORMAT. Уберите переменную в начале" },
      { metaId: "5", status: "APPROVED", reason: null },
      { metaId: "6", status: "APPROVED", reason: null },
    ]);
  });
});
