import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  connectMetaAccount,
  connectTelegramBot,
  createWaTemplate,
  deleteChannel,
  deleteWaTemplate,
  syncWaTemplates,
  setChannelEnabled,
  tgUserConfirm,
  tgUserLogin,
} from "@/lib/crm/channels.server";
import { isBotToken } from "@/lib/crm/telegram";

/**
 * Аккаунты каналов CRM («Настройки» → «Каналы»): подключить, отключить,
 * удалить. Только право «CRM: настройка» — проверяет база от имени
 * вызывающего (auth_crm_can_manage); токены дальше сервера не уходят.
 */
async function requireManage(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("auth_crm_can_manage");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Каналы подключает тот, у кого есть право «CRM: настройка»");
}

const uuidOrNull = z.string().uuid().nullable();

/** Ошибка проверки — первой понятной строкой, а не JSON zod. */
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) throw new Error(res.error.issues[0]?.message ?? "Неверные данные");
  return res.data;
}

export const connectTelegramBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    parse(
      z.object({
        name: z.string().trim().max(80),
        token: z.string().trim().refine(isBotToken, "Это не похоже на токен бота от @BotFather"),
        studioId: uuidOrNull,
        pipelineId: uuidOrNull,
      }),
      data,
    ),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return connectTelegramBot({ ...data, userId: context.userId });
  });

export const connectMetaAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    parse(
      z.object({
        kind: z.enum(["whatsapp", "facebook", "instagram"]),
        name: z.string().trim().max(80),
        token: z.string().trim().min(20, "Вставьте токен доступа").max(1000),
        phoneNumberId: z
          .string()
          .trim()
          .regex(/^\d{5,25}$/, "Phone number ID — только цифры")
          .nullable(),
        wabaId: z
          .string()
          .trim()
          .regex(/^\d{5,25}$/, "ID аккаунта WhatsApp Business — только цифры")
          .nullable(),
        studioId: uuidOrNull,
        pipelineId: uuidOrNull,
      }),
      data,
    ),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return connectMetaAccount({ ...data, userId: context.userId });
  });

export const setChannelEnabledFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parse(z.object({ id: z.string().uuid(), enabled: z.boolean() }), data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    await setChannelEnabled(data.id, data.enabled);
    return { ok: true };
  });

export const deleteChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parse(z.object({ id: z.string().uuid() }), data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    await deleteChannel(data.id);
    return { ok: true };
  });

// Шаблоны WhatsApp («Настройки» → «Шаблоны WhatsApp») -----------------------------

export const createWaTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    parse(
      z.object({
        accountId: z.string().uuid(),
        name: z
          .string()
          .trim()
          .regex(
            /^[a-z0-9_]{3,60}$/,
            "Имя шаблона — латиница в нижнем регистре, цифры и «_», от 3 знаков",
          ),
        language: z.enum(["ru", "en", "ka"]),
        category: z.enum(["MARKETING", "UTILITY"]),
        body: z
          .string()
          .trim()
          .min(1, "Напишите текст шаблона")
          .max(1024, "Текст длиннее 1024 знаков"),
        footer: z.string().trim().max(60, "Подпись длиннее 60 знаков").nullable(),
      }),
      data,
    ),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return createWaTemplate({ ...data, userId: context.userId });
  });

export const syncWaTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parse(z.object({ accountId: z.string().uuid() }), data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return { count: await syncWaTemplates(data.accountId) };
  });

export const deleteWaTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parse(z.object({ id: z.string().uuid() }), data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    await deleteWaTemplate(data.id);
    return { ok: true };
  });

// Личный Telegram («Настройки» → «Каналы» → «Telegram (личный)») -------------------

/** Шаг 1: номер телефона аккаунта — Telegram присылает код. */
export const tgUserLoginFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    parse(
      z.object({
        accountId: z.string().uuid().nullable(),
        name: z.string().trim().max(80),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[\d\s()-]{8,25}$/, "Номер — с кодом страны, например +995 555 12 34 56"),
        studioId: uuidOrNull,
        pipelineId: uuidOrNull,
      }),
      data,
    ),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return tgUserLogin({ ...data, userId: context.userId });
  });

/** Шаги 2 и 3: код из Telegram и, если включён, облачный пароль. */
export const tgUserConfirmFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    parse(
      z.object({
        accountId: z.string().uuid(),
        code: z.string().trim().max(12).optional(),
        password: z.string().max(200).optional(),
      }),
      data,
    ),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return tgUserConfirm(data);
  });
