/**
 * Автоматизации этапов CRM — фоновый цикл сервера админки (CRM.md, этап 3).
 * Что и когда делать, решает база (очередь crm_automation_jobs,
 * crm_automations_run): задачи, ответственные, переводы и теги она
 * выполняет сама, а сообщения клиентам отдаёт сюда — отправить в канал
 * может только сервер (токены). Очередь в базе: перезапуск её не теряет,
 * два контейнера при выкатке берут разные задания (skip locked).
 */
import { getSupabaseAdmin, hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { getPushSigner } from "@/lib/push/push-worker.server";
import { sendWebPush } from "@/lib/push/web-push.server";
import { sendAutoMessage, syncPendingWaTemplates } from "./channels.server";

const TICK_MS = 10_000;
/** Что пора уведомить (сроки задач, ожидание ответа) — раз в минуту. */
const NOTIFY_COLLECT_MS = 60_000;
/** Сценарии по клиентам клуба (продление, возврат, долги) — раз в 10 минут. */
const SCENARIOS_MS = 10 * 60_000;

type MessageJob = { job_id: string; conversation_id: string; body: string };

type StaffNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  targets: { endpoint: string; p256dh: string; auth: string }[];
};

const g = globalThis as typeof globalThis & {
  __base40CrmAutomations?: {
    started: boolean;
    running: boolean;
    lastError: string | null;
    notifying: boolean;
    collectedAt: number;
    lastNotifyError: string | null;
    lastScenariosError: string | null;
  };
};
const state = (g.__base40CrmAutomations ??= {
  started: false,
  running: false,
  lastError: null,
  notifying: false,
  collectedAt: 0,
  lastNotifyError: null,
  lastScenariosError: null,
});

export function startCrmAutomations() {
  // Как у рассылки пушей: PUSH_WORKER=off — фоновую работу делает другой сервер.
  if (state.started || !hasSupabaseAdmin() || process.env.PUSH_WORKER === "off") return;
  state.started = true;
  setInterval(() => void runCrmAutomations(), TICK_MS);
  setInterval(() => void runCrmNotifications(), TICK_MS);
  setTimeout(() => void runCrmScenarios(), 60_000);
  setInterval(() => void runCrmScenarios(), SCENARIOS_MS);
  // Шаблоны WhatsApp на проверке Meta: статус приходит вебхуком, это запас.
  setInterval(() => void syncPendingWaTemplates().catch(() => {}), 15 * 60_000);
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

/**
 * Уведомления сотрудникам в браузер (Web Push): раз в минуту база решает,
 * что пора уведомить (crm_notifications_collect), каждый проход — отправка
 * заведённого (в том числе «вам назначили сделку» — его заводит триггер).
 */
export async function runCrmNotifications(): Promise<void> {
  if (state.notifying) return;
  state.notifying = true;
  try {
    const admin = getSupabaseAdmin();
    if (Date.now() - state.collectedAt >= NOTIFY_COLLECT_MS) {
      state.collectedAt = Date.now();
      const { error } = await admin.rpc("crm_notifications_collect");
      if (error) throw new Error(error.message);
    }
    const { data, error } = await admin.rpc("crm_notifications_claim", { p_limit: 100 });
    if (error) throw new Error(error.message);
    const list = (data as StaffNotification[] | null) ?? [];
    if (list.length === 0) {
      state.lastNotifyError = null;
      return;
    }
    const signer = await getPushSigner();
    const gone: string[] = [];
    await Promise.all(
      list.flatMap((n) => {
        const payload = JSON.stringify({ t: n.title, b: n.body ?? "", u: n.url, n: n.id });
        return n.targets.map(async (target) => {
          // Напоминание живёт недолго: через час оно уже не ко времени.
          const res = await sendWebPush(target, payload, signer, { ttl: 3600 });
          if (res.outcome === "gone") gone.push(target.endpoint);
        });
      }),
    );
    if (gone.length > 0) await admin.rpc("crm_push_gone", { p_endpoints: gone });
    state.lastNotifyError = null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message !== state.lastNotifyError) console.error("[crm] уведомления:", message);
    state.lastNotifyError = message;
  } finally {
    state.notifying = false;
  }
}

/** Сделки по включённым сценариям («Настройки» → «Сценарии»). */
export async function runCrmScenarios(): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc("crm_scenarios_run");
  if (error) {
    if (error.message !== state.lastScenariosError) console.error("[crm] сценарии:", error.message);
    state.lastScenariosError = error.message;
    return;
  }
  state.lastScenariosError = null;
  if (typeof data === "number" && data > 0)
    console.info(`[crm] сценарии: заведено сделок — ${data}`);
}
