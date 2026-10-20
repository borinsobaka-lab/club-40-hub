import { describe, expect, test } from "bun:test";
import { pickNext, type QueueState } from "../src/round-robin";

function run(users: number[], times: number, start: QueueState | null = null) {
  const out: number[] = [];
  let state = start;
  for (let i = 0; i < times; i++) {
    const r = pickNext(users, state)!;
    out.push(r.userId);
    state = r.state;
  }
  return { out, state };
}

describe("pickNext", () => {
  test("по кругу с первого", () => {
    expect(run([1, 2, 3], 7).out).toEqual([1, 2, 3, 1, 2, 3, 1]);
  });

  test("пустой список — никого", () => {
    expect(pickNext([], null)).toBeNull();
  });

  test("добавили человека — очередь продолжается", () => {
    const { state } = run([1, 2, 3], 2); // последний — 2
    expect(run([1, 2, 4, 3], 3, state).out).toEqual([4, 3, 1]);
  });

  test("убрали того, кто получил последнюю — следующий за ним", () => {
    const { state } = run([1, 2, 3], 2); // последний — 2 на месте 1
    expect(run([1, 3], 2, state).out).toEqual([3, 1]);
  });

  test("убрали последнего в списке — с начала", () => {
    const { state } = run([1, 2, 3], 3); // последний — 3 на месте 2
    expect(run([1, 2], 2, state).out).toEqual([1, 2]);
  });

  test("переставили — следующий после последнего по новому порядку", () => {
    const { state } = run([1, 2, 3], 1); // последний — 1
    expect(run([3, 1, 2], 3, state).out).toEqual([2, 3, 1]);
  });
});
