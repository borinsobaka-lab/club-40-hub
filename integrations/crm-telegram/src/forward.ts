import type { Outbound } from "./accounts";
import type { Config } from "./config";

const RETRY_MS = [1000, 5000, 20000];

/**
 * Отдать событие админке (POST multipart: meta — JSON, file — вложение).
 * Сбой сети и 5xx — три повтора; 4xx — не повторяем (админка отказала).
 */
export function makeForwarder(cfg: Config, fetchFn: typeof fetch = fetch) {
  return async (payload: Outbound): Promise<void> => {
    const { file, ...meta } = payload.type === "message" ? payload : { ...payload, file: null };
    const build = () => {
      const form = new FormData();
      form.set("meta", JSON.stringify(meta));
      if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.mime ?? "application/octet-stream" }));
      return form;
    };
    let last = "";
    for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
      try {
        const res = await fetchFn(cfg.adminUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.secret}` },
          body: build(),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) return;
        last = `админка ответила ${res.status}`;
        if (res.status < 500) break;
      } catch (e) {
        last = e instanceof Error ? e.message : "нет связи";
      }
      if (attempt < RETRY_MS.length) await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
    }
    throw new Error(last);
  };
}
