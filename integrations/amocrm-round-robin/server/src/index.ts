import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { Store } from "./store";

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const store = new Store(cfg.dbPath);
const app = createApp(cfg, store);

store.pruneAssignments();
setInterval(() => store.pruneAssignments(), 24 * 3600_000);

Bun.serve({ port: cfg.port, hostname: "0.0.0.0", fetch: app.fetch });
console.log(`Очередь ответственных amoCRM: порт ${cfg.port}, ${cfg.publicUrl}`);
