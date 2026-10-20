import { Database } from "bun:sqlite";
import { pickNext, type QueueState } from "./round-robin";

/**
 * Хранилище сервера — один файл SQLite (в Docker — на томе /data).
 * Bun выполняет запросы синхронно в одном потоке, поэтому выбор следующего
 * ответственного и запись очереди не перемешаются, даже если две сделки
 * пришли одновременно.
 */
export interface Account {
  id: number;
  subdomain: string;
  /** Домен аккаунта: amocrm.ru, amocrm.com, kommo.com. */
  baseDomain: string;
  accessToken: string;
  refreshToken: string;
  /** Unix-время (с), когда истекает access token. */
  expiresAt: number;
  /** Часть адреса вебхука: без неё чужой запрос не назначит ответственного. */
  webhookSecret: string;
  /** Не удалось подписаться на вебхук — текст ошибки для окна виджета. */
  webhookError: string | null;
}

export type AssignmentStatus = "pending" | "assigned" | "skipped" | "failed";

export interface Assignment {
  leadId: number;
  userId: number | null;
  status: AssignmentStatus;
  note: string | null;
  createdAt: number;
}

export class Store {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(`
      create table if not exists accounts (
        id integer primary key,
        subdomain text not null,
        base_domain text not null,
        access_token text not null,
        refresh_token text not null,
        expires_at integer not null,
        webhook_secret text not null unique,
        webhook_error text,
        updated_at integer not null
      );
      create table if not exists queue (
        account_id integer primary key,
        last_user_id integer,
        last_index integer not null default 0
      );
      create table if not exists assignments (
        account_id integer not null,
        lead_id integer not null,
        user_id integer,
        status text not null,
        note text,
        created_at integer not null,
        primary key (account_id, lead_id)
      );
    `);
  }

  saveAccount(a: Account) {
    this.db
      .query(
        `insert into accounts (id, subdomain, base_domain, access_token, refresh_token,
           expires_at, webhook_secret, webhook_error, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
         on conflict (id) do update set subdomain = ?2, base_domain = ?3,
           access_token = ?4, refresh_token = ?5, expires_at = ?6,
           webhook_secret = ?7, webhook_error = ?8, updated_at = unixepoch()`,
      )
      .run(
        a.id,
        a.subdomain,
        a.baseDomain,
        a.accessToken,
        a.refreshToken,
        a.expiresAt,
        a.webhookSecret,
        a.webhookError,
      );
  }

  getAccount(id: number): Account | null {
    const r = this.db.query("select * from accounts where id = ?").get(id) as Record<
      string,
      never
    > | null;
    return r
      ? {
          id: r.id,
          subdomain: r.subdomain,
          baseDomain: r.base_domain,
          accessToken: r.access_token,
          refreshToken: r.refresh_token,
          expiresAt: r.expires_at,
          webhookSecret: r.webhook_secret,
          webhookError: r.webhook_error,
        }
      : null;
  }

  getAccountBySecret(secret: string): Account | null {
    const r = this.db.query("select id from accounts where webhook_secret = ?").get(secret) as {
      id: number;
    } | null;
    return r ? this.getAccount(r.id) : null;
  }

  setWebhookError(accountId: number, error: string | null) {
    this.db.query("update accounts set webhook_error = ? where id = ?").run(error, accountId);
  }

  deleteAccount(id: number) {
    this.db.transaction(() => {
      this.db.query("delete from accounts where id = ?").run(id);
      this.db.query("delete from queue where account_id = ?").run(id);
    })();
  }

  /**
   * Занять сделку: true — сделку видим впервые (amoCRM повторяет вебхук,
   * если ответ не пришёл быстро, — второй раз ответственного не меняем).
   */
  claimLead(accountId: number, leadId: number): boolean {
    const r = this.db
      .query(
        `insert into assignments (account_id, lead_id, status, created_at)
         values (?, ?, 'pending', unixepoch()) on conflict do nothing`,
      )
      .run(accountId, leadId);
    return r.changes > 0;
  }

  /** Следующий по очереди из списка; очередь сдвигается сразу. */
  takeNext(accountId: number, users: readonly number[]): number | null {
    return this.db.transaction(() => {
      const row = this.db
        .query("select last_user_id, last_index from queue where account_id = ?")
        .get(accountId) as { last_user_id: number | null; last_index: number } | null;
      const state: QueueState | null = row
        ? { lastUserId: row.last_user_id, lastIndex: row.last_index }
        : null;
      const next = pickNext(users, state);
      if (!next) return null;
      this.db
        .query(
          `insert into queue (account_id, last_user_id, last_index) values (?1, ?2, ?3)
           on conflict (account_id) do update set last_user_id = ?2, last_index = ?3`,
        )
        .run(accountId, next.state.lastUserId, next.state.lastIndex);
      return next.userId;
    })();
  }

  /** Кто получит следующую сделку (без сдвига очереди) — для настроек виджета. */
  peekNext(accountId: number, users: readonly number[]): number | null {
    const row = this.db
      .query("select last_user_id, last_index from queue where account_id = ?")
      .get(accountId) as { last_user_id: number | null; last_index: number } | null;
    return (
      pickNext(users, row ? { lastUserId: row.last_user_id, lastIndex: row.last_index } : null)
        ?.userId ?? null
    );
  }

  finishLead(
    accountId: number,
    leadId: number,
    status: AssignmentStatus,
    userId: number | null,
    note: string | null = null,
  ) {
    this.db
      .query(
        `update assignments set status = ?, user_id = ?, note = ?
         where account_id = ? and lead_id = ?`,
      )
      .run(status, userId, note, accountId, leadId);
  }

  getAssignment(accountId: number, leadId: number): Assignment | null {
    const r = this.db
      .query(
        `select lead_id, user_id, status, note, created_at from assignments
         where account_id = ? and lead_id = ?`,
      )
      .get(accountId, leadId) as Record<string, never> | null;
    return r
      ? {
          leadId: r.lead_id,
          userId: r.user_id,
          status: r.status,
          note: r.note,
          createdAt: r.created_at,
        }
      : null;
  }

  recentAssignments(accountId: number, limit = 20): Assignment[] {
    return (
      this.db
        .query(
          `select lead_id, user_id, status, note, created_at from assignments
           where account_id = ? and status <> 'pending'
           order by created_at desc, rowid desc limit ?`,
        )
        .all(accountId, limit) as Record<string, never>[]
    ).map((r) => ({
      leadId: r.lead_id,
      userId: r.user_id,
      status: r.status,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  /** Журнал не растёт бесконечно: дубли вебхуков приходят в первые минуты. */
  pruneAssignments(olderThanDays = 90) {
    this.db
      .query("delete from assignments where created_at < unixepoch() - ? * 86400")
      .run(olderThanDays);
  }
}
