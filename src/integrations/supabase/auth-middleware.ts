import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import {
  authenticate,
  bearerToken,
  getProfileStudioId,
  getStudioStaffRoles,
} from "@/lib/staff-auth.server";

/**
 * Middleware серверных функций. Токен прикладывает attachSupabaseAuth
 * (auth-attacher.ts) на стороне браузера.
 */

/** Любой авторизованный пользователь: context.supabase — клиент от его имени. */
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const token = bearerToken(getRequestHeader("authorization"));
    const auth = token ? await authenticate(token) : null;
    // Error, а не Response: брошенный Response клиент получал как «данные»
    // (useQuery видел объект без полей и страница падала), Error же приходит
    // в onError/error с этим текстом.
    if (!auth) throw new Error("Сессия истекла. Войдите заново.");
    return next({ context: { supabase: auth.supabase, userId: auth.user.id } });
  },
);

/** Сотрудник своей студии (profiles.studio_id): добавляет studioId и isOwner. */
export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const studioId = await getProfileStudioId(context.supabase, context.userId);
    if (!studioId) throw new Error("Студия не найдена для пользователя");
    const roles = await getStudioStaffRoles(context.supabase, context.userId, studioId);
    if (!roles.length) throw new Error("Доступ только для сотрудников");
    return next({ context: { studioId, isOwner: roles.includes("owner") } });
  });

/** Владелец студии. */
export const requireOwner = createMiddleware({ type: "function" })
  .middleware([requireStaff])
  .server(async ({ next, context }) => {
    if (!context.isOwner) throw new Error("Только владелец студии может управлять сотрудниками");
    return next();
  });
