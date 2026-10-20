import { beforeEach, describe, expect, test } from "bun:test";
import { Processor, type AmoApi } from "../src/processor";
import { Store } from "../src/store";
import { parseWebhook } from "../src/webhook";

const UNSORTED = 69;

class FakeAmo implements AmoApi {
  id = 1;
  config: unknown = JSON.stringify({ users: [10, 20, 30], skip_manual: false });
  active: Set<number> | null = new Set([10, 20, 30, 40]);
  calls: [number, number][] = [];
  failTimes = 0;
  async widgetSettings() {
    return { rr_config: this.config };
  }
  async activeUserIds() {
    return this.active;
  }
  async unsortedStatusIds() {
    return new Set([UNSORTED]);
  }
  async setResponsible(leadId: number, userId: number) {
    if (this.failTimes-- > 0) throw new Error("amoCRM ответил 500");
    this.calls.push([leadId, userId]);
  }
}

const added = (...leads: { id: number; created?: number }[]) =>
  parseWebhook(
    leads
      .flatMap((l, i) => [
        `leads[add][${i}][id]=${l.id}`,
        `leads[add][${i}][created_user_id]=${l.created ?? 0}`,
      ])
      .join("&") + "&account[id]=1",
  );

const accepted = (id: number, responsible: number) =>
  parseWebhook(
    `leads[status][0][id]=${id}&leads[status][0][old_status_id]=${UNSORTED}` +
      `&leads[status][0][status_id]=70&leads[status][0][responsible_user_id]=${responsible}`,
  );

describe("Processor", () => {
  let store: Store;
  let amo: FakeAmo;
  let proc: Processor;
  beforeEach(() => {
    store = new Store(":memory:");
    amo = new FakeAmo();
    proc = new Processor(store, "rr", () => {}, [0, 0]);
  });

  test("по очереди между выбранными", async () => {
    await proc.handle(amo, added({ id: 1 }, { id: 2 }));
    await proc.handle(amo, added({ id: 3 }, { id: 4 }));
    expect(amo.calls).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 10],
    ]);
  });

  test("повтор вебхука не двигает очередь", async () => {
    await proc.handle(amo, added({ id: 1 }));
    await proc.handle(amo, added({ id: 1 }));
    await proc.handle(amo, added({ id: 2 }));
    expect(amo.calls).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });

  test("неактивный пользователь пропускается", async () => {
    amo.active = new Set([10, 30]);
    await proc.handle(amo, added({ id: 1 }, { id: 2 }, { id: 3 }));
    expect(amo.calls.map((c) => c[1])).toEqual([10, 30, 10]);
  });

  test("список пользователей недоступен — очередь как выбрана", async () => {
    amo.active = null;
    await proc.handle(amo, added({ id: 1 }, { id: 2 }));
    expect(amo.calls.map((c) => c[1])).toEqual([10, 20]);
  });

  test("пустая очередь — сделку не трогаем", async () => {
    amo.config = undefined;
    await proc.handle(amo, added({ id: 1 }));
    expect(amo.calls).toEqual([]);
    expect(store.getAssignment(1, 1)?.status).toBe("skipped");
  });

  test("созданные вручную — по настройке", async () => {
    amo.config = { users: [10, 20], skip_manual: true };
    await proc.handle(amo, added({ id: 1, created: 40 }, { id: 2 }));
    expect(amo.calls).toEqual([[2, 10]]);
    expect(store.getAssignment(1, 1)?.note).toBe("создана сотрудником вручную");
  });

  test("ошибка amoCRM — повтор, потом успех", async () => {
    amo.failTimes = 2;
    await proc.handle(amo, added({ id: 1 }));
    expect(amo.calls).toEqual([[1, 10]]);
    expect(store.getAssignment(1, 1)?.status).toBe("assigned");
  });

  test("ошибка amoCRM каждый раз — в журнал, очередь идёт дальше", async () => {
    amo.failTimes = 3;
    await proc.handle(amo, added({ id: 1 }));
    await proc.handle(amo, added({ id: 2 }));
    expect(store.getAssignment(1, 1)?.status).toBe("failed");
    expect(amo.calls).toEqual([[2, 20]]);
  });

  test("принятие из «Неразобранного» без add_lead — назначаем по очереди", async () => {
    await proc.handle(amo, accepted(5, 40));
    expect(amo.calls).toEqual([[5, 10]]);
  });

  test("принятие из «Неразобранного» сменило ответственного — возвращаем", async () => {
    await proc.handle(amo, added({ id: 5 }));
    await proc.handle(amo, accepted(5, 40));
    await proc.handle(amo, added({ id: 6 }));
    expect(amo.calls).toEqual([
      [5, 10],
      [5, 10],
      [6, 20],
    ]);
  });

  test("принятие с тем же ответственным — ничего", async () => {
    await proc.handle(amo, added({ id: 5 }));
    await proc.handle(amo, accepted(5, 10));
    expect(amo.calls).toEqual([[5, 10]]);
  });

  test("обычная смена этапа — не наше дело", async () => {
    await proc.handle(
      amo,
      parseWebhook(
        "leads[status][0][id]=7&leads[status][0][old_status_id]=70&leads[status][0][status_id]=71",
      ),
    );
    expect(amo.calls).toEqual([]);
  });
});
