import { expect, test } from "bun:test";
import { parseWebhook } from "../src/webhook";

test("новые сделки и смена этапа из вебхука", () => {
  const body = new URLSearchParams({
    "leads[add][0][id]": "101",
    "leads[add][0][name]": "Заявка с сайта",
    "leads[add][0][responsible_user_id]": "5",
    "leads[add][0][created_user_id]": "0",
    "leads[add][0][status_id]": "70",
    "leads[add][0][custom_fields][0][id]": "1",
    "leads[add][1][id]": "102",
    "leads[add][1][created_user_id]": "5",
    "leads[status][0][id]": "90",
    "leads[status][0][status_id]": "71",
    "leads[status][0][old_status_id]": "69",
    "leads[status][0][responsible_user_id]": "8",
    "account[id]": "31000000",
    "account[subdomain]": "base40",
  }).toString();
  expect(parseWebhook(body)).toEqual({
    accountId: 31000000,
    added: [
      { id: 101, responsibleUserId: 5, createdUserId: 0, statusId: 70, oldStatusId: 0 },
      { id: 102, responsibleUserId: 0, createdUserId: 5, statusId: 0, oldStatusId: 0 },
    ],
    statusChanged: [
      { id: 90, responsibleUserId: 8, createdUserId: 0, statusId: 71, oldStatusId: 69 },
    ],
  });
});

test("вебхук без интересных событий", () => {
  const p = parseWebhook("leads[update][0][id]=1&account[id]=2&account[subdomain]=x");
  expect(p.added).toEqual([]);
  expect(p.statusChanged).toEqual([]);
});
