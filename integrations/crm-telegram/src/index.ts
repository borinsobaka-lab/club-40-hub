import { Accounts } from "./accounts";
import { configProblems, loadConfig } from "./config";
import { makeForwarder } from "./forward";
import { GramDriver } from "./gram-driver";
import { makeHandler } from "./server";
import { Store } from "./store";

// Сервис личных аккаунтов Telegram для CRM админки (CRM.md, README.md).
// Один экземпляр и том /data: тот же вход с двух соединений Telegram
// сбрасывает.
const cfg = loadConfig();
const missing = configProblems(cfg);
if (missing.length) console.error("[tg] не заданы переменные:", missing.join(", "));

const store = new Store(cfg.dataDir);
const accounts = new Accounts(cfg, store, () => new GramDriver(cfg.apiId, cfg.apiHash), makeForwarder(cfg));

Bun.serve({ port: cfg.port, fetch: makeHandler(cfg, accounts), maxRequestBodySize: 22 * 1024 * 1024 });
console.log(`[tg] сервис слушает :${cfg.port}`);

if (!missing.length) void accounts.boot().then(() => console.log("[tg] аккаунты подключены"));
