import { beforeEach, describe, expect, test } from "bun:test";
import type { AmoLead } from "../src/amo";
import type { DpEvent } from "../src/dp";
import { Processor, type AmoApi } from "../src/processor";
import { Store } from "../src/store";

const PIPELINE = 5;
const STAGE = 70;

class FakeAmo implements AmoApi {
  id = 1;
  config: unknown = JSON.stringify({ users: [10, 20, 30], skip_manual: false });
  active: Set<number> | null = new Set([10, 20, 30, 40]);
  calls: [number, number][] = [];
  reads = 0;
  failTimes = 0;
  /** Сделки аккаунта; нет в списке — 404. */
  leads = new Map<number, Partial<AmoLead>>();
  async widgetSettings() {
    return { rr_config: this.config };
  }
  async activeUserIds() {
    return this.active;
  }
  async getLead(id: number): Promise<AmoLead | null> {
    this.reads++;
    const l = this.leads.get(id);
    return l
      ? {
          id,
          pipeline_id: PIPELINE,
          status_id: STAGE,
          responsible_user_id: 1,
          created_by: 0,
          ...l,
        }
      : null;
  }
  async setResponsible(leadId: number, userId: number) {
    if (this.failTimes-- > 0) throw new Error("amoCRM ответил 500");
    this.calls.push([leadId, userId]);
  }
}

const ev = (leadId: number, over: Partial<DpEvent> = {}): DpEvent => ({
  accountId: 1,
  subdomain: "base40",
  type: "lead_added",
  elementType: 2,
  leadId,
  statusId: STAGE,
  pipelineId: PIPELINE,
  ...over,
});

describe("Processor", () => {
  let store: Store;
  let amo: FakeAmo;
  let proc: Processor;
  beforeEach(() => {
    store = new Store(":memory:");
    amo = new FakeAmo();
    for (const id of [1, 2, 3, 4, 5]) amo.leads.set(id, {});
    proc = new Processor(store, () => {}, [0, 0]);
  });

  test("по очереди между выбранными", async () => {
    for (const id of [1, 2, 3, 4]) await proc.handle(amo, ev(id));
    expect(amo.calls).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 10],
    ]);
  });

  test("повтор события не двигает очередь и не читает сделку", async () => {
    await proc.handle(amo, ev(1));
    await proc.handle(amo, ev(1));
    await proc.handle(amo, ev(2));
    expect(amo.calls).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(amo.reads).toBe(2);
  });

  test("та же сделка в другом этапе с триггером — новое назначение", async () => {
    await proc.handle(amo, ev(1));
    await proc.handle(amo, ev(1, { statusId: STAGE + 1 }));
    expect(amo.calls).toEqual([
      [1, 10],
      [1, 20],
    ]);
  });

  test("не сделка — ничего", async () => {
    await proc.handle(amo, ev(1, { elementType: 1 }));
    expect(amo.calls).toEqual([]);
    expect(amo.reads).toBe(0);
  });

  test("сделки нет в аккаунте — ничего, в журнал не пишем", async () => {
    await proc.handle(amo, ev(99));
    expect(amo.calls).toEqual([]);
    expect(store.getAssignment(1, 99)).toBeNull();
    // и событие не занято: настоящее с тем же id потом пройдёт
    amo.leads.set(99, {});
    await proc.handle(amo, ev(99));
    expect(amo.calls).toEqual([[99, 10]]);
  });

  test("сделка в другой воронке — ничего", async () => {
    await proc.handle(amo, ev(1, { pipelineId: PIPELINE + 1 }));
    expect(amo.calls).toEqual([]);
  });

  test("неактивный пользователь пропускается", async () => {
    amo.active = new Set([10, 30]);
    for (const id of [1, 2, 3]) await proc.handle(amo, ev(id));
    expect(amo.calls.map((c) => c[1])).toEqual([10, 30, 10]);
  });

  test("список пользователей недоступен — очередь как выбрана", async () => {
    amo.active = null;
    for (const id of [1, 2]) await proc.handle(amo, ev(id));
    expect(amo.calls.map((c) => c[1])).toEqual([10, 20]);
  });

  test("пустая очередь — сделку не трогаем", async () => {
    amo.config = undefined;
    await proc.handle(amo, ev(1));
    expect(amo.calls).toEqual([]);
    expect(store.getAssignment(1, 1)?.status).toBe("skipped");
  });

  test("созданные вручную — по настройке; из источника — распределяем", async () => {
    amo.config = { users: [10, 20], skip_manual: true };
    amo.leads.set(1, { created_by: 40 });
    amo.leads.set(3, { created_by: 40, source_id: 7 });
    for (const id of [1, 2, 3]) await proc.handle(amo, ev(id));
    expect(amo.calls).toEqual([
      [2, 10],
      [3, 20],
    ]);
    expect(store.getAssignment(1, 1)?.note).toBe("создана сотрудником вручную");
  });

  test("ошибка amoCRM — повтор, потом успех", async () => {
    amo.failTimes = 2;
    await proc.handle(amo, ev(1));
    expect(amo.calls).toEqual([[1, 10]]);
    expect(store.getAssignment(1, 1)?.status).toBe("assigned");
  });

  test("ошибка amoCRM каждый раз — в журнал, очередь идёт дальше", async () => {
    amo.failTimes = 3;
    await proc.handle(amo, ev(1));
    await proc.handle(amo, ev(2));
    expect(store.getAssignment(1, 1)?.status).toBe("failed");
    expect(amo.calls).toEqual([[2, 20]]);
  });
});
