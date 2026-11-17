/**
 * Автоматизации этапов CRM — фоновый цикл сервера админки (CRM.md, этап 3).
 * Что и когда делать, решает база (очередь crm_automation_jobs,
 * crm_automations_run): задачи, ответственные, переводы и теги она
 * выполняет сама, а сообщения клиентам отдаёт сюда — отправить в канал
 * может только сервер (токены). Очередь в базе: перезапуск её не теряет,
 * два контейнера при выкатке берут разные задания (skip locked).
 */
import { getSupabaseAdmin, hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { sendAutoMessage } from "./channels.server";

const TICK_MS = 10_000;

type MessageJob = { job_id: string; conversation_id: string; body: string };

const g = globalThis as typeof globalThis & {
  __base40CrmAutomations?: { started: boolean; running: boolean; lastError: string | null };
};
const state = (g.__base40CrmAutomations ??= { started: false, running: false, lastError: null });

export function startCrmAutomations() {
  // Как у рассылки пушей: PUSH_WORKER=off — фоновую работу делает другой сервер.
  if (state.started || !hasSupabaseAdmin() || process.env.PUSH_WORKER === "off") return;
  state.started = true;
  setInterval(() => void runCrmAutomations(), TICK_MS);
}

export async function runCrmAutomations(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("crm_automations_run", { p_limit: 50 });
    if (error) {
      if (error.message !== state.lastError) console.error("[crm] автоматизации:", error.message);
      state.lastError = error.message;
      return;
    }
    state.lastError = null;
    for (const job of (data as MessageJob[] | null) ?? []) {
      let failure: string | null = null;
      try {
        await sendAutoMessage(job.conversation_id, job.body);
      } catch (e) {
        failure = e instanceof Error ? e.message : "Не отправлено";
      }
      const { error: finishError } = await admin.rpc("crm_automation_job_finish", {
        p_job: job.job_id,
        p_ok: failure === null,
        p_error: failure,
      });
      if (finishError) console.error("[crm] итог автоматизации:", finishError.message);
    }
  } finally {
    state.running = false;
  }
}
