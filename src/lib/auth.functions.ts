import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createAnonClient,
  getSupabaseAdmin,
  hasSupabaseAdmin,
} from "@/integrations/supabase/client.server";
import { STAFF_ROLES } from "@/lib/roles";

/**
 * Вход в админку — только по ссылке на почту, паролей у сотрудников нет.
 *
 * Ссылку отправляем, только если почта принадлежит сотруднику: клиенты
 * приложения живут в том же Supabase, и письмо «вход в админку» им слать
 * нельзя. Проверка роли идёт сервис-ключом, поэтому она здесь, на сервере.
 * Ответ одинаковый для любой почты — по нему нельзя узнать, кто сотрудник.
 */
export const requestStaffLoginLink = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email("Неверный адрес почты"),
        // Куда вернуть после входа. GoTrue пускает только адреса из своего
        // списка redirect URLs, а хук писем по этому хосту понимает, что письмо
        // из админки (ссылка, а не код).
        redirectTo: z.string().url(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    // Без сервис-ключа роль не проверить. Чтобы не запереть всех снаружи,
    // шлём ссылку как есть: не-сотрудника всё равно не пустит guard
    // (_authenticated/route.tsx), теряется лишь «письма только сотрудникам».
    if (!hasSupabaseAdmin()) {
      console.warn("[auth] APP_SUPABASE_SERVICE_KEY не задан — ссылка без проверки роли");
      return sendLink(data.email, data.redirectTo);
    }
    const admin = getSupabaseAdmin();
    // profiles.email заполняется при создании пользователя (handle_new_user).
    const pattern = data.email.replace(/[\\%_]/g, "\\$&");
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", pattern);
    if (error) throw new Error(error.message);
    const ids = (profiles ?? []).map((p) => p.id as string);
    if (ids.length === 0) return { ok: true };

    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id")
      .in("user_id", ids)
      .in("role", STAFF_ROLES)
      .limit(1);
    if (rolesErr) throw new Error(rolesErr.message);
    if (!roles?.length) return { ok: true };

    return sendLink(data.email, data.redirectTo);
  });

async function sendLink(email: string, redirectTo: string) {
  const { error } = await createAnonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  // Нет такого пользователя (shouldCreateUser: false) — молчим, как и для
  // не-сотрудника.
  if (error && !/signups not allowed|user not found/i.test(error.message)) {
    // Частая причина — лимит GoTrue на повторную отправку.
    throw new Error(
      /seconds|rate limit/i.test(error.message)
        ? "Письмо уже отправлено. Повторить можно через минуту."
        : `Не удалось отправить письмо: ${error.message}`,
    );
  }
  return { ok: true };
}
