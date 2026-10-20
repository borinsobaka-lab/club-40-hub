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
  /**
   * Секрет адреса вебхука аккаунта. С 2026-10-20 вебхук аккаунта не
   * создаётся (сделки приходят из цифровой воронки, POST /dp), но колонка
   * в базе осталась — not null unique, поэтому пишем случайное значение.
   */
  webhookSecret: string;
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
      -- События цифровой воронки, уже взятые в работу: amoCRM повторяет
      -- запрос (до 4 раз в час), а одна сделка может пройти несколько этапов
      -- с триггером — ключ «сделка × этап».
      create table if not exists dp_events (
        account_id integer not null,
        lead_id integer not null,
        status_id integer not null,
        created_at integer not null,
        primary key (account_id, lead_id, status_id)
      );
    `);
  }

  saveAccount(a: Account) {
    this.db
      .query(
        `insert into accounts (id, subdomain, base_domain, access_token, refresh_token,
           expires_at, webhook_secret, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
         on conflict (id) do update set subdomain = ?2, base_domain = ?3,
           access_token = ?4, refresh_token = ?5, expires_at = ?6,
           webhook_secret = ?7, updated_at = unixepoch()`,
      )
      .run(
        a.id,
        a.subdomain,
        a.baseDomain,
        a.accessToken,
        a.refreshToken,
        a.expiresAt,
        a.webhookSecret,
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
        }
      : null;
  }

  deleteAccount(id: number) {
    this.db.transaction(() => {
      this.db.query("delete from accounts where id = ?").run(id);
      this.db.query("delete from queue where account_id = ?").run(id);
      this.db.query("delete from dp_events where account_id = ?").run(id);
    })();
  }

  /** Событие «сделка × этап» уже обрабатывали — повтор от amoCRM. */
  hasDpEvent(accountId: number, leadId: number, statusId: number): boolean {
    return !!this.db
      .query("select 1 from dp_events where account_id = ? and lead_id = ? and status_id = ?")
      .get(accountId, leadId, statusId);
  }

  /**
   * Занять событие: true — видим впервые. Сделка встаёт в журнал «Последние
   * сделки» заново (pending), даже если раньше её назначали в другом этапе.
   */
  claimDpEvent(accountId: number, leadId: number, statusId: number): boolean {
    return this.db.transaction(() => {
      const r = this.db
        .query(
          `insert into dp_events (account_id, lead_id, status_id, created_at)
           values (?, ?, ?, unixepoch()) on conflict do nothing`,
        )
        .run(accountId, leadId, statusId);
      if (r.changes === 0) return false;
      this.db
        .query(
          `insert into assignments (account_id, lead_id, status, created_at)
           values (?1, ?2, 'pending', unixepoch())
           on conflict (account_id, lead_id) do update set status = 'pending',
             user_id = null, note = null, created_at = unixepoch()`,
        )
        .run(accountId, leadId);
      return true;
    })();
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

  /** Журнал не растёт бесконечно: повторы amoCRM приходят в первый час. */
  pruneAssignments(olderThanDays = 90) {
    for (const table of ["assignments", "dp_events"]) {
      this.db
        .query(`delete from ${table} where created_at < unixepoch() - ? * 86400`)
        .run(olderThanDays);
    }
  }
}
