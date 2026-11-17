import { timingSafeEqual } from "node:crypto";

import { ServiceError, type Accounts } from "./accounts";
import { configProblems, type Config } from "./config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_UPLOAD = 21 * 1024 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status });

function authorized(request: Request, secret: string): boolean {
  const got = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return secret.length >= 24 && got.length === want.length && timingSafeEqual(got, want);
}

/**
 * HTTP-API сервиса — только для сервера админки (заголовок Authorization:
 * Bearer <CRM_TG_SECRET>). Сессии и коды входа наружу не отдаются.
 */
export function makeHandler(cfg: Config, accounts: Accounts) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const problems = configProblems(cfg);
      return json({ ok: problems.length === 0, missing: problems }, problems.length ? 503 : 200);
    }
    if (!authorized(request, cfg.secret)) return json({ error: "forbidden" }, 403);
    const m = /^\/accounts\/([^/]+)(?:\/(login|code|password|send|resolve))?$/.exec(url.pathname);
    if (!m || !UUID.test(m[1])) return json({ error: "not found" }, 404);
    const [, id, action] = m;
    try {
      if (!action && request.method === "GET")
        return json({ ...accounts.status(id), starts_left: accounts.startsLeft(id) });
      if (!action && request.method === "DELETE") {
        await accounts.logout(id);
        return json({ ok: true });
      }
      if (request.method !== "POST" || !action) return json({ error: "not found" }, 404);
      if (action === "send") {
        if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD)
          return json({ error: "Файл больше 20 МБ" }, 413);
        const form = await request.formData();
        const file = form.get("file");
        return json(
          await accounts.send(
            id,
            String(form.get("chat_id") ?? ""),
            String(form.get("text") ?? ""),
            file instanceof File && file.size > 0
              ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
              : null,
          ),
        );
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
      if (action === "login") return json(await accounts.loginStart(id, str("phone")));
      if (action === "code") return json(await accounts.loginCode(id, str("code")));
      if (action === "password") return json(await accounts.loginPassword(id, str("password")));
      const peer = await accounts.resolve(id, {
        phone: str("phone") || undefined,
        username: str("username") || undefined,
        name: str("name") || undefined,
      });
      return json({ chat_id: peer.id, username: peer.username, name: peer.name, phone: peer.phone });
    } catch (e) {
      if (e instanceof ServiceError) return json({ error: e.message }, e.status);
      console.error("[tg] запрос:", e instanceof Error ? e.message : e);
      return json({ error: "Сбой сервиса Telegram" }, 500);
    }
  };
}
