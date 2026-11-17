import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectTelegramBot, deleteChannel, setChannelEnabled } from "@/lib/crm/channels.server";
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

export const connectTelegramBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        name: z.string().trim().max(80),
        token: z.string().trim().refine(isBotToken, "Это не похоже на токен бота от @BotFather"),
        studioId: uuidOrNull,
        pipelineId: uuidOrNull,
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    return connectTelegramBot({ ...data, userId: context.userId });
  });

export const setChannelEnabledFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    await setChannelEnabled(data.id, data.enabled);
    return { ok: true };
  });

export const deleteChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await requireManage(context.supabase);
    await deleteChannel(data.id);
    return { ok: true };
  });
