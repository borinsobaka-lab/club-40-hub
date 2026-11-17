/**
 * CRM — уведомления сотруднику в браузер (Web Push; CRM.md, «Скорость
 * ответа и уведомления»): срок задачи, клиент ждёт ответа, назначена сделка.
 * Подписку оформляет браузер (service worker public/sw.js, ключ сервера —
 * RPC push_public_key), в базу её пишет crm_push_subscribe. Включается на
 * каждом браузере отдельно; работает в установленной и в обычной вкладке
 * (на iPhone — только у приложения «На экран „Домой“»).
 */
import { supabase } from "@/integrations/supabase/client";

export type NotifyState =
  /** Браузер не умеет или service worker не запущен (дев-сервер). */
  | "unsupported"
  /** Запрещены в настройках браузера. */
  | "denied"
  | "off"
  | "on";

function b64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob((text + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function save(subscription: PushSubscription) {
  const keys = subscription.toJSON().keys ?? {};
  const { error } = await supabase.rpc("crm_push_subscribe", {
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh ?? "",
    p_auth: keys.auth ?? "",
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

/** Состояние на этом браузере; включённую подписку заодно сверяет с базой. */
export async function notifyState(): Promise<NotifyState> {
  const reg = await registration();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription || Notification.permission !== "granted") return "off";
  // Браузер мог сменить подписку сам — база должна знать актуальную.
  await save(subscription).catch(() => {});
  return "on";
}

export async function enableNotify(): Promise<NotifyState> {
  const reg = await registration();
  if (!reg) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { data: key, error } = await supabase.rpc("push_public_key");
  if (error || typeof key !== "string" || !key)
    throw new Error("Сервер уведомлений ещё не готов — попробуйте позже");
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(key),
    }));
  await save(subscription);
  return "on";
}

export async function disableNotify(): Promise<NotifyState> {
  const reg = await registration();
  if (!reg) return "unsupported";
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await supabase.rpc("crm_push_unsubscribe", { p_endpoint: subscription.endpoint });
    await subscription.unsubscribe().catch(() => {});
  }
  return "off";
}
