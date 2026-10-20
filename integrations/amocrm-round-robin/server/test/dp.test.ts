import { expect, test } from "bun:test";
import { parseDpEvent, parseNestedForm } from "../src/dp";

const expected = {
  accountId: 777,
  subdomain: "base40",
  type: "lead_added",
  elementType: 2,
  leadId: 123,
  statusId: 70,
  pipelineId: 5,
};

test("JSON", () => {
  const body = JSON.stringify({
    event: {
      type: 1,
      type_code: "lead_added",
      data: { id: 123, element_type: 2, status_id: 70, pipeline_id: 5 },
    },
    action: { settings: { widget: { settings: {} } } },
    subdomain: "base40",
    account_id: 777,
  });
  expect(parseDpEvent(body, "application/json")).toEqual(expected);
  // Content-Type не указан, а тело — JSON
  expect(parseDpEvent(body, "")).toEqual(expected);
});

test("form-data со вложенными ключами, числа строками", () => {
  const body =
    "event[type]=1&event[type_code]=lead_added&event[data][id]=123" +
    "&event[data][element_type]=2&event[data][status_id]=70&event[data][pipeline_id]=5" +
    "&subdomain=base40&account_id=777";
  expect(parseDpEvent(body, "application/x-www-form-urlencoded")).toEqual(expected);
});

test("без type_code — берём type", () => {
  expect(parseDpEvent('{"event":{"type":1,"data":{}}}', "application/json")?.type).toBe("1");
});

test("битый JSON — null", () => {
  expect(parseDpEvent("{oops", "application/json")).toBeNull();
});

test("вложенная форма", () => {
  expect(parseNestedForm("a[b][c]=1&a[b][d]=2&e=3")).toEqual({
    a: { b: { c: "1", d: "2" } },
    e: "3",
  });
});
