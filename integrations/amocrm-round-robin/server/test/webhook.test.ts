import { expect, test } from "bun:test";
import { parseWebhook } from "../src/webhook";

test("новые сделки из вебхука", () => {
  const body = new URLSearchParams({
    "leads[add][0][id]": "101",
    "leads[add][0][name]": "Заявка с сайта",
    "leads[add][0][responsible_user_id]": "5",
    "leads[add][0][created_user_id]": "0",
    "leads[add][0][pipeline_id]": "7",
    "leads[add][0][status_id]": "70",
    "leads[add][0][custom_fields][0][id]": "1",
    "leads[add][1][id]": "102",
    "leads[add][1][created_user_id]": "5",
    "account[id]": "31000000",
    "account[subdomain]": "base40",
  }).toString();
  expect(parseWebhook(body)).toEqual({
    accountId: 31000000,
    subdomain: "base40",
    leads: [
      { id: 101, responsibleUserId: 5, createdUserId: 0, pipelineId: 7, statusId: 70 },
      { id: 102, responsibleUserId: 0, createdUserId: 5, pipelineId: 0, statusId: 0 },
    ],
  });
});

test("вебхук без новых сделок", () => {
  const body = "leads[update][0][id]=1&account[id]=2&account[subdomain]=x";
  expect(parseWebhook(body).leads).toEqual([]);
});
