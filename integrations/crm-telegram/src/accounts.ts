import type { Config } from "./config";
import { isSessionDead, tgErrorText, type TgDriver, type TgMessage, type TgPeer, type TgUser } from "./driver";
import type { Store } from "./store";

export type AccountState = "offline" | "awaiting_code" | "awaiting_password" | "online" | "error";

export type AccountStatus = { state: AccountState; user: TgUser | null; note: string | null };

/** Что сервис отдаёт админке. */
export type Outbound =
  | {
      type: "message";
      account_id: string;
      direction: "in" | "out";
      chat_id: string;
      peer: { external_id: string; username: string | null; name: string | null; phone: string | null };
      message: { external_id: string; body: string | null; sent_at: string };
      file: { name: string; mime: string | null; bytes: Uint8Array } | null;
      /** Вложение было, но не скачалось (больше 20 МБ). */
      file_skipped: string | null;
    }
  | { type: "status"; account_id: string; state: AccountState; note: string | null };

type Entry = { driver: TgDriver; state: AccountState; note: string | null };

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const DAY = 24 * 3600_000;

/**
 * Аккаунты личного Telegram: вход (номер → код → облачный пароль), приём
 * сообщений и пересылка в админку, отправка, «написать первым» с суточным
 * пределом новых чатов (Telegram блокирует аккаунты за рассылки незнакомым).
 */
export class Accounts {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
    private readonly makeDriver: () => TgDriver,
    private readonly forward: (payload: Outbound) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** После запуска сервиса — подключить аккаунты с сохранённым входом. */
  async boot(): Promise<void> {
    for (const id of this.store.ids()) {
      const rec = this.store.get(id);
      if (!rec?.session) continue;
      const entry: Entry = { driver: this.makeDriver(), state: "offline", note: null };
      this.entries.set(id, entry);
      try {
        if (await entry.driver.connect(rec.session)) this.goOnline(id, entry);
        else await this.fail(id, entry, "Вход в аккаунт сброшен — войдите заново");
      } catch (e) {
        await this.fail(id, entry, tgErrorText(e));
      }
    }
  }

  /** Отправленное из CRM (аккаунт:сообщение) и отправки, которые ещё идут. */
  private sent = new Set<string>();
  private inFlight = new Set<Promise<void>>();

  status(id: string): AccountStatus {
    const entry = this.entries.get(id);
    const rec = this.store.get(id);
    return {
      state: entry?.state ?? "offline",
      user: rec?.user ? { ...rec.user, phone: rec.phone } : null,
      note: entry?.note ?? null,
    };
  }

  private goOnline(id: string, entry: Entry) {
    entry.state = "online";
    entry.note = null;
    entry.driver.onMessage((m) => void this.onMessage(id, m));
  }

  private async fail(id: string, entry: Entry, note: string) {
    entry.state = "error";
    entry.note = note;
    await this.forward({ type: "status", account_id: id, state: "error", note }).catch(() => {});
  }

  private async onMessage(id: string, m: TgMessage) {
    if (m.out) {
      await Promise.all([...this.inFlight]);
      if (this.sent.has(`${id}:${m.id}`)) return;
    }
    this.store.setPeer(id, m.peer.id, m.peer.accessHash);
    let file: { name: string; mime: string | null; bytes: Uint8Array } | null = null;
    let skipped: string | null = null;
    if (m.file) {
      const bytes = await m.file.download().catch(() => null);
      if (bytes) file = { name: m.file.name, mime: m.file.mime, bytes };
      else skipped = m.file.name;
    }
    if (!m.text && !file && !skipped) return;
    await this.forward({
      type: "message",
      account_id: id,
      direction: m.out ? "out" : "in",
      chat_id: m.peer.id,
      peer: { external_id: m.peer.id, username: m.peer.username, name: m.peer.name, phone: m.peer.phone },
      message: { external_id: m.id, body: m.text, sent_at: new Date(m.date * 1000).toISOString() },
      file,
      file_skipped: skipped,
    }).catch((e) => console.error("[tg] пересылка:", e instanceof Error ? e.message : e));
  }

  // Вход ------------------------------------------------------------------------

  async loginStart(id: string, phone: string): Promise<{ via_app: boolean }> {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) throw new ServiceError("Неверный номер телефона");
    const old = this.entries.get(id);
    if (old) await old.driver.disconnect().catch(() => {});
    const entry: Entry = { driver: this.makeDriver(), state: "offline", note: null };
    this.entries.set(id, entry);
    try {
      await entry.driver.connect("");
      const res = await entry.driver.sendCode(`+${digits}`);
      entry.state = "awaiting_code";
      this.store.update(id, { session: "", phone: `+${digits}`, user: null });
      return { via_app: res.viaApp };
    } catch (e) {
      throw new ServiceError(tgErrorText(e));
    }
  }

  async loginCode(id: string, code: string): Promise<AccountStatus> {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "awaiting_code") throw new ServiceError("Сначала запросите код");
    try {
      const res = await entry.driver.signIn(code.replace(/\D/g, ""));
      if (res === "password_needed") {
        entry.state = "awaiting_password";
        return this.status(id);
      }
      return await this.finish(id, entry);
    } catch (e) {
      throw new ServiceError(tgErrorText(e));
    }
  }

  async loginPassword(id: string, password: string): Promise<AccountStatus> {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "awaiting_password") throw new ServiceError("Пароль сейчас не нужен");
    try {
      await entry.driver.signInPassword(password);
      return await this.finish(id, entry);
    } catch (e) {
      throw new ServiceError(tgErrorText(e));
    }
  }

  private async finish(id: string, entry: Entry): Promise<AccountStatus> {
    const user = await entry.driver.me();
    this.store.update(id, {
      session: entry.driver.session(),
      user: { id: user.id, username: user.username, name: user.name },
    });
    this.goOnline(id, entry);
    return this.status(id);
  }

  async logout(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) await entry.driver.logout().catch(() => {});
    this.entries.delete(id);
    this.store.remove(id);
  }

  // Отправка --------------------------------------------------------------------

  private online(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "online")
      throw new ServiceError(entry?.note ?? "Аккаунт Telegram не подключён — войдите в него в настройках CRM", 409);
    return entry;
  }

  private async guard<T>(id: string, entry: Entry, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isSessionDead(e)) await this.fail(id, entry, tgErrorText(e));
      throw new ServiceError(tgErrorText(e));
    }
  }

  async send(
    id: string,
    chatId: string,
    text: string,
    file: { name: string; bytes: Uint8Array } | null,
  ): Promise<{ message_id: string }> {
    const entry = this.online(id);
    const accessHash = this.store.get(id)?.peers[chatId];
    if (!accessHash)
      throw new ServiceError("Сервис не знает этого собеседника — начните чат заново («Написать в Telegram»)");
    const peer = { id: chatId, accessHash };
    // Своё же сообщение Telegram присылает и событием «исходящее» — иногда
    // раньше, чем вернётся ответ на отправку. Пока идёт отправка, исходящие
    // события ждут, а потом отправленное из CRM пропускается: админка
    // запишет его сама, с именем сотрудника.
    const sending = this.guard(id, entry, () =>
      file ? entry.driver.sendFile(peer, file, text || null) : entry.driver.sendText(peer, text),
    ).then((messageId) => {
      this.sent.add(`${id}:${messageId}`);
      if (this.sent.size > 5000) this.sent.delete(this.sent.values().next().value as string);
      return messageId;
    });
    const settled = sending.then(
      () => {},
      () => {},
    );
    this.inFlight.add(settled);
    void settled.then(() => this.inFlight.delete(settled));
    return { message_id: await sending };
  }

  /** Сколько новых чатов ещё можно начать сегодня. */
  startsLeft(id: string): number {
    const since = this.now() - DAY;
    const used = (this.store.get(id)?.started ?? []).filter((t) => t > since).length;
    return Math.max(0, this.cfg.newChatsPerDay - used);
  }

  /** Найти человека по номеру или @нику, чтобы написать первым. */
  async resolve(id: string, target: { phone?: string; username?: string; name?: string }): Promise<TgPeer> {
    const entry = this.online(id);
    if (!target.phone && !target.username) throw new ServiceError("Укажите номер или @ник");
    if (this.startsLeft(id) <= 0)
      throw new ServiceError(
        `Сегодня с этого аккаунта уже начато ${this.cfg.newChatsPerDay} новых чатов — больше нельзя, иначе Telegram заблокирует аккаунт`,
        429,
      );
    const peer = await this.guard(id, entry, () =>
      entry.driver.resolve({
        username: target.username,
        phone: target.phone ? `+${target.phone.replace(/\D/g, "")}` : undefined,
        name: target.name,
      }),
    );
    if (!peer) throw new ServiceError("Этого человека нет в Telegram (или он скрыл номер)", 404);
    const rec = this.store.get(id)!;
    // Уже знакомый собеседник в суточный предел не идёт.
    if (!rec.peers[peer.id])
      this.store.update(id, { started: [...rec.started.filter((t) => t > this.now() - DAY), this.now()] });
    this.store.setPeer(id, peer.id, peer.accessHash);
    return peer;
  }
}
