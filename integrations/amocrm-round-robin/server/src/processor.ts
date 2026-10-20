import type { Store } from "./store";
import { parseSettings, SETTINGS_FIELD, type QueueSettings } from "./settings";
import type { LeadEvent, WebhookPayload } from "./webhook";

/** То, что обработчику нужно от amoCRM (в тестах — подделка). */
export interface AmoApi {
  readonly id: number;
  widgetSettings(): Promise<Record<string, unknown>>;
  activeUserIds(): Promise<Set<number> | null>;
  unsortedStatusIds(): Promise<Set<number>>;
  setResponsible(leadId: number, userId: number): Promise<unknown>;
}

interface Cached<T> {
  value: T;
  until: number;
}

const SETTINGS_TTL = 10_000;
const USERS_TTL = 10 * 60_000;
const PIPELINES_TTL = 10 * 60_000;

/**
 * Назначение ответственного по очереди.
 *
 * - Новая сделка (add_lead) — следующий по очереди из выбранных в виджете.
 * - Сделка из «Неразобранного»: попадает ли она в add_lead при поступлении,
 *   amoCRM не документирует, поэтому ловим и её принятие (status_lead со
 *   старым этапом «Неразобранное»). Не видели раньше — назначаем по очереди;
 *   уже назначили, а при принятии ответственный сменился — возвращаем
 *   назначенного (очередь не двигается).
 * - Повтор того же вебхука ничего не меняет: сделка помечается в журнале.
 */
export class Processor {
  private settings = new Map<number, Cached<QueueSettings>>();
  private users = new Map<number, Cached<Set<number> | null>>();
  private unsorted = new Map<number, Cached<Set<number>>>();

  constructor(
    private store: Store,
    private log: (msg: string) => void = console.log,
    private retryDelays: number[] = [1000, 5000],
  ) {}

  async handle(api: AmoApi, payload: WebhookPayload) {
    for (const lead of payload.added) await this.assignNew(api, lead, false);
    if (payload.statusChanged.length > 0) {
      const unsorted = await this.cached(this.unsorted, api.id, PIPELINES_TTL, () =>
        api.unsortedStatusIds(),
      );
      for (const lead of payload.statusChanged) {
        if (!unsorted.has(lead.oldStatusId) || unsorted.has(lead.statusId)) continue;
        await this.onAccepted(api, lead);
      }
    }
  }

  /** Сбросить кэш настроек — после «Сохранить» в виджете. */
  forgetSettings(accountId: number) {
    this.settings.delete(accountId);
  }

  async queueSettings(api: AmoApi) {
    return this.cached(this.settings, api.id, SETTINGS_TTL, async () =>
      parseSettings((await api.widgetSettings())[SETTINGS_FIELD]),
    );
  }

  /** Выбранные в виджете, кроме неактивных пользователей amoCRM. */
  async queueUsers(api: AmoApi, settings: QueueSettings) {
    const active = await this.cached(this.users, api.id, USERS_TTL, () => api.activeUserIds());
    return active ? settings.users.filter((u) => active.has(u)) : settings.users;
  }

  private async assignNew(api: AmoApi, lead: LeadEvent, accepted: boolean) {
    if (!this.store.claimLead(api.id, lead.id)) return;
    try {
      const settings = await this.queueSettings(api);
      const users = await this.queueUsers(api, settings);
      if (users.length === 0) {
        this.finish(api, lead, "skipped", null, "очередь пуста — в виджете никто не выбран");
        return;
      }
      // Принятая из «Неразобранного» — всегда входящая заявка, даже если
      // created_user_id — сотрудник, который её принял.
      if (settings.skipManual && !accepted && lead.createdUserId > 0) {
        this.finish(api, lead, "skipped", null, "создана сотрудником вручную");
        return;
      }
      const userId = this.store.takeNext(api.id, users)!;
      await this.setResponsible(api, lead, userId);
    } catch (e) {
      this.finish(api, lead, "failed", null, String((e as Error).message ?? e));
    }
  }

  private async onAccepted(api: AmoApi, lead: LeadEvent) {
    const prev = this.store.getAssignment(api.id, lead.id);
    if (!prev) return this.assignNew(api, lead, true);
    if (prev.status !== "assigned" || !prev.userId) return;
    if (lead.responsibleUserId === prev.userId) return;
    try {
      await this.setResponsible(
        api,
        lead,
        prev.userId,
        "возвращён после принятия из Неразобранного",
      );
    } catch (e) {
      this.log(`[${api.id}] сделка ${lead.id}: ${(e as Error).message}`);
    }
  }

  private async setResponsible(api: AmoApi, lead: LeadEvent, userId: number, note?: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.setResponsible(lead.id, userId);
        this.finish(api, lead, "assigned", userId, note ?? null);
        return;
      } catch (e) {
        if (attempt >= this.retryDelays.length) {
          // Очередь уже сдвинута: этот человек пропускает ход, но сделка
          // в журнале — видно в окне виджета.
          this.finish(api, lead, "failed", userId, String((e as Error).message ?? e));
          return;
        }
        await Bun.sleep(this.retryDelays[attempt]);
      }
    }
  }

  private finish(
    api: AmoApi,
    lead: LeadEvent,
    status: "assigned" | "skipped" | "failed",
    userId: number | null,
    note: string | null,
  ) {
    this.store.finishLead(api.id, lead.id, status, userId, note);
    this.log(
      `[${api.id}] сделка ${lead.id}: ${status}${userId ? ` → ${userId}` : ""}${note ? ` (${note})` : ""}`,
    );
  }

  private async cached<T>(
    map: Map<number, Cached<T>>,
    key: number,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = map.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    map.set(key, { value, until: Date.now() + ttl });
    return value;
  }
}
