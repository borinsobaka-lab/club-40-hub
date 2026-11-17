import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { Logger } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";

import type { LoginCodeResult, TgDriver, TgMessage, TgPeer, TgUser } from "./driver";

/** Файлы входящих больше этого не скачиваем (как у бота). */
const MAX_DOWNLOAD = 20 * 1024 * 1024;

function userOf(u: Api.User): TgUser {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
  return {
    id: u.id.toString(),
    username: u.username ?? null,
    name,
    phone: u.phone ? `+${u.phone.replace(/\D/g, "")}` : null,
  };
}

function peerOf(u: Api.User): TgPeer {
  return { ...userOf(u), accessHash: (u.accessHash ?? bigInt.zero).toString() };
}

const input = (p: { id: string; accessHash: string }) =>
  new Api.InputPeerUser({ userId: bigInt(p.id), accessHash: bigInt(p.accessHash) });

/** Вложение сообщения: имя, тип и размер — без скачивания. */
function fileOf(message: Api.Message) {
  const media = message.media;
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo)
    return { name: `photo-${message.id}.jpg`, mime: "image/jpeg", size: null as number | null };
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const named = doc.attributes.find(
      (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
    );
    const voice = doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio && a.voice);
    const ext = doc.mimeType.split("/")[1]?.split(";")[0] ?? "bin";
    return {
      name: named?.fileName ?? `${voice ? "voice" : "file"}-${message.id}.${ext}`,
      mime: doc.mimeType || null,
      size: Number(doc.size.toString()),
    };
  }
  return null;
}

/**
 * Личный аккаунт Telegram через MTProto (GramJS). Один экземпляр — один
 * аккаунт и одно соединение: тот же ключ входа с двух соединений сразу
 * Telegram сбрасывает (AUTH_KEY_DUPLICATED), поэтому сервис — в одном
 * экземпляре.
 */
export class GramDriver implements TgDriver {
  private client: TelegramClient | null = null;
  private phone = "";
  private codeHash = "";
  private handler: ((message: TgMessage) => void) | null = null;

  constructor(
    private readonly apiId: number,
    private readonly apiHash: string,
  ) {}

  private make(session: string): TelegramClient {
    const client = new TelegramClient(new StringSession(session), this.apiId, this.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      baseLogger: new Logger("error" as never),
      deviceModel: "Base40 CRM",
      appVersion: "1.0",
    });
    client.addEventHandler((event: NewMessageEvent) => void this.onEvent(event), new NewMessage({}));
    return client;
  }

  private get c(): TelegramClient {
    if (!this.client) throw new Error("Аккаунт не подключён");
    return this.client;
  }

  async connect(session: string): Promise<boolean> {
    await this.disconnect();
    this.client = this.make(session);
    await this.client.connect();
    return session ? await this.client.checkAuthorization() : false;
  }

  async sendCode(phone: string): Promise<{ viaApp: boolean }> {
    if (!this.client) await this.connect("");
    this.phone = phone;
    const res = await this.c.sendCode({ apiId: this.apiId, apiHash: this.apiHash }, phone);
    this.codeHash = res.phoneCodeHash;
    return { viaApp: res.isCodeViaApp };
  }

  async signIn(code: string): Promise<LoginCodeResult> {
    try {
      await this.c.invoke(
        new Api.auth.SignIn({ phoneNumber: this.phone, phoneCodeHash: this.codeHash, phoneCode: code }),
      );
      return "ok";
    } catch (e) {
      if ((e as { errorMessage?: string }).errorMessage === "SESSION_PASSWORD_NEEDED") return "password_needed";
      throw e;
    }
  }

  async signInPassword(password: string): Promise<void> {
    await this.c.signInWithPassword(
      { apiId: this.apiId, apiHash: this.apiHash },
      {
        password: async () => password,
        onError: (e) => {
          throw e;
        },
      },
    );
  }

  async me(): Promise<TgUser> {
    return userOf((await this.c.getMe()) as Api.User);
  }

  session(): string {
    return (this.c.session as StringSession).save();
  }

  onMessage(handler: (message: TgMessage) => void) {
    this.handler = handler;
  }

  private async onEvent(event: NewMessageEvent) {
    try {
      const message = event.message;
      if (!this.handler || !event.isPrivate || !(message.peerId instanceof Api.PeerUser)) return;
      // Собеседник личного чата — и у входящего, и у отправленного нами.
      const entity = await this.c.getEntity(message.peerId).catch(() => null);
      if (!(entity instanceof Api.User) || entity.bot || entity.self) return;
      const file = fileOf(message);
      this.handler({
        id: String(message.id),
        out: !!message.out,
        peer: peerOf(entity),
        text: message.message || null,
        date: message.date,
        file: file && {
          ...file,
          download: async () => {
            if ((file.size ?? 0) > MAX_DOWNLOAD) return null;
            const data = await this.c.downloadMedia(message, {}).catch(() => null);
            return data instanceof Uint8Array ? data : null;
          },
        },
      });
    } catch (e) {
      console.error("[tg] событие:", e instanceof Error ? e.message : e);
    }
  }

  async sendText(peer: { id: string; accessHash: string }, text: string): Promise<string> {
    const sent = await this.c.sendMessage(input(peer), { message: text });
    return String(sent.id);
  }

  async sendFile(
    peer: { id: string; accessHash: string },
    file: { name: string; bytes: Uint8Array },
    caption: string | null,
  ): Promise<string> {
    const buffer = Buffer.from(file.bytes);
    const sent = await this.c.sendFile(input(peer), {
      file: new CustomFile(file.name, buffer.length, "", buffer),
      caption: caption ?? undefined,
      forceDocument: !/\.(jpe?g|png|webp)$/i.test(file.name),
    });
    return String(sent.id);
  }

  async resolve(target: { phone?: string; username?: string; name?: string }): Promise<TgPeer | null> {
    if (target.username) {
      const res = await this.c.invoke(
        new Api.contacts.ResolveUsername({ username: target.username.replace(/^@/, "") }),
      );
      const user = res.users.find((u): u is Api.User => u instanceof Api.User && !u.bot);
      return user ? peerOf(user) : null;
    }
    if (target.phone) {
      // Telegram находит человека по номеру только через добавление в контакты.
      const res = await this.c.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: bigInt(Date.now()),
              phone: target.phone,
              firstName: target.name?.trim() || target.phone,
              lastName: "",
            }),
          ],
        }),
      );
      const user = res.users.find((u): u is Api.User => u instanceof Api.User);
      return user ? peerOf(user) : null;
    }
    return null;
  }

  async logout(): Promise<void> {
    if (!this.client) return;
    await this.client.invoke(new Api.auth.LogOut()).catch(() => {});
    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.destroy().catch(() => {});
  }
}
