import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Что сервис помнит между перезапусками (файл на томе /data):
 *   session — ключ входа аккаунта в Telegram (как пароль: кто его получит,
 *             войдёт в аккаунт; наружу сервис его не отдаёт);
 *   peers   — «адрес» каждого собеседника (access_hash): без него Telegram
 *             не даёт написать человеку по одному id;
 *   started — когда начинали новые чаты (суточный предел).
 */
export type AccountRecord = {
  session: string;
  phone: string | null;
  user: { id: string; username: string | null; name: string | null } | null;
  peers: Record<string, string>;
  started: number[];
};

export class Store {
  private readonly file: string;
  private data: Record<string, AccountRecord> = {};

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "accounts.json");
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, AccountRecord>;
      } catch {
        // Битый файл не должен ронять сервис: аккаунты войдут заново.
        this.data = {};
      }
    }
  }

  ids(): string[] {
    return Object.keys(this.data);
  }

  get(id: string): AccountRecord | null {
    return this.data[id] ?? null;
  }

  update(id: string, patch: Partial<AccountRecord>): AccountRecord {
    const current = this.data[id] ?? { session: "", phone: null, user: null, peers: {}, started: [] };
    this.data[id] = { ...current, ...patch };
    this.flush();
    return this.data[id];
  }

  setPeer(id: string, chatId: string, accessHash: string) {
    const rec = this.data[id];
    if (!rec || rec.peers[chatId] === accessHash) return;
    rec.peers[chatId] = accessHash;
    this.flush();
  }

  remove(id: string) {
    delete this.data[id];
    this.flush();
  }

  /** Запись через временный файл: обрыв посреди записи не портит сессии. */
  private flush() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
