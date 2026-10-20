import type { AmoLead } from "./amo";
import type { Store } from "./store";
import { parseSettings, SETTINGS_FIELD, type QueueSettings } from "./settings";
import { ELEMENT_LEAD, type DpEvent } from "./dp";

/** То, что обработчику нужно от amoCRM (в тестах — подделка). */
export interface AmoApi {
  readonly id: number;
  widgetSettings(): Promise<Record<string, unknown>>;
  activeUserIds(): Promise<Set<number> | null>;
  getLead(leadId: number): Promise<AmoLead | null>;
  setResponsible(leadId: number, userId: number): Promise<unknown>;
}

interface Cached<T> {
  value: T;
  until: number;
}

const SETTINGS_TTL = 10_000;
const USERS_TTL = 10 * 60_000;

/**
 * Назначение ответственного по очереди — по событию цифровой воронки: на
 * этапе стоит триггер «Очередь ответственных», условие сработало.
 *
 * - Только сделки (element_type = 2) и только существующие в аккаунте:
 *   подписи у запроса нет, поэтому сделку сначала читаем через API.
 * - Повтор события (amoCRM повторяет до 4 раз в час) очередь не двигает:
 *   сделка в одном этапе назначается один раз. Тот же триггер в другом
 *   этапе — новое назначение.
 */
export class Processor {
  private settings = new Map<number, Cached<QueueSettings>>();
  private users = new Map<number, Cached<Set<number> | null>>();

  constructor(
    private store: Store,
    private log: (msg: string) => void = console.log,
    private retryDelays: number[] = [1000, 5000],
  ) {}

  async handle(api: AmoApi, ev: DpEvent) {
    const tag = `[${api.id}] сделка ${ev.leadId}, этап ${ev.statusId}`;
    if (ev.elementType !== ELEMENT_LEAD || ev.leadId <= 0) {
      this.log(
        `[${api.id}] событие воронки не по сделке (element_type ${ev.elementType}) — пропуск`,
      );
      return;
    }
    if (this.store.hasDpEvent(api.id, ev.leadId, ev.statusId)) {
      this.log(`${tag}: повтор события — пропуск`);
      return;
    }
    let lead: AmoLead | null;
    try {
      lead = await api.getLead(ev.leadId);
    } catch (e) {
      this.log(`${tag}: не удалось прочитать сделку — ${(e as Error).message ?? e}`);
      return;
    }
    // Чужие или выдуманные сделки в журнал не пишем — только в лог.
    if (!lead) {
      this.log(`${tag}: сделки нет в аккаунте — пропуск`);
      return;
    }
    if (ev.pipelineId > 0 && lead.pipeline_id !== ev.pipelineId) {
      this.log(`${tag}: сделка в другой воронке (${lead.pipeline_id}) — пропуск`);
      return;
    }
    if (!this.store.claimDpEvent(api.id, ev.leadId, ev.statusId)) return;

    try {
      const settings = await this.queueSettings(api);
      const users = await this.queueUsers(api, settings);
      if (users.length === 0) {
        this.finish(api, ev.leadId, "skipped", null, "очередь пуста — в виджете никто не выбран");
        return;
      }
      // Сделки из источников (формы, чаты, «Неразобранное») — входящие,
      // даже если created_by — сотрудник, который принял заявку.
      if (settings.skipManual && lead.created_by > 0 && !lead.source_id) {
        this.finish(api, ev.leadId, "skipped", null, "создана сотрудником вручную");
        return;
      }
      const userId = this.store.takeNext(api.id, users)!;
      await this.setResponsible(api, ev.leadId, userId);
    } catch (e) {
      this.finish(api, ev.leadId, "failed", null, String((e as Error).message ?? e));
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

  private async setResponsible(api: AmoApi, leadId: number, userId: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.setResponsible(leadId, userId);
        this.finish(api, leadId, "assigned", userId, null);
        return;
      } catch (e) {
        if (attempt >= this.retryDelays.length) {
          // Очередь уже сдвинута: этот человек пропускает ход, но сделка
          // в журнале — видно в окне виджета.
          this.finish(api, leadId, "failed", userId, String((e as Error).message ?? e));
          return;
        }
        await Bun.sleep(this.retryDelays[attempt]);
      }
    }
  }

  private finish(
    api: AmoApi,
    leadId: number,
    status: "assigned" | "skipped" | "failed",
    userId: number | null,
    note: string | null,
  ) {
    this.store.finishLead(api.id, leadId, status, userId, note);
    this.log(
      `[${api.id}] сделка ${leadId}: ${status}${userId ? ` → ${userId}` : ""}${note ? ` (${note})` : ""}`,
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
