import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ListItemButton } from "@/components/ui/list-item-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CRM_KEY,
  crmFileUrl,
  crmTemplatesQuery,
  markConversationRead,
  sendCrmMessage,
  useMessages,
} from "@/lib/crm/data";
import { dayLabel, fileSize, fillTemplate } from "@/lib/crm/logic";
import type { CrmAttachment, CrmMessage } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const MAX_FILE = 20 * 1024 * 1024;

/**
 * Переписка диалога и поле ответа — одна и та же в «Диалогах» и в карточке
 * сделки. Открытый диалог считается прочитанным; новые сообщения
 * подтягиваются опросом (lib/crm/data.ts). Отправка — через сервер админки.
 */
export function ChatThread({
  conversationId,
  contactName,
  studioName,
  disabledReason,
}: {
  conversationId: string;
  contactName?: string | null;
  studioName?: string | null;
  /** Почему ответить нельзя (аккаунт отключён) — вместо поля ввода. */
  disabledReason?: string | null;
}) {
  const qc = useQueryClient();
  const { data: messages, isLoading } = useMessages(conversationId);
  const scroller = useRef<HTMLDivElement | null>(null);
  const lastId = messages?.[messages.length - 1]?.id;
  const lastIncoming = [...(messages ?? [])].reverse().find((m) => m.direction === "in")?.id;

  // Новое сообщение — прокрутка вниз.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  // Открыт диалог или пришло новое входящее — прочитано.
  useEffect(() => {
    if (!lastIncoming) return;
    void markConversationRead(conversationId)
      .then(() => qc.invalidateQueries({ queryKey: [CRM_KEY, "conversations"] }))
      .catch(() => {});
  }, [conversationId, lastIncoming, qc]);

  const now = new Date();
  let prevDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3 sm:px-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-16 w-3/5" />
          </div>
        ) : (messages ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Сообщений пока нет.</p>
        ) : (
          messages!.map((m) => {
            const day = dayLabel(m.created_at, now);
            const header = day !== prevDay;
            prevDay = day;
            return (
              <div key={m.id}>
                {header && (
                  <div className="my-2 text-center text-xs text-muted-foreground">{day}</div>
                )}
                <Bubble message={m} />
              </div>
            );
          })
        )}
      </div>
      {disabledReason ? (
        <div className="border-t bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason}
        </div>
      ) : (
        <Composer
          conversationId={conversationId}
          contactName={contactName}
          studioName={studioName}
        />
      )}
    </div>
  );
}

function Bubble({ message: m }: { message: CrmMessage }) {
  const out = m.direction === "out";
  const time = new Date(m.created_at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm",
          out ? "rounded-br-sm bg-sky-100 text-sky-950" : "rounded-bl-sm bg-muted",
          m.status === "failed" && "bg-destructive/10",
        )}
      >
        {m.attachments.map((a, i) => (
          <Attachment key={i} attachment={a} />
        ))}
        {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground",
            out && "justify-end",
          )}
        >
          {m.status === "failed" && (
            <span
              className="inline-flex items-center gap-1 text-destructive"
              title={m.error ?? undefined}
            >
              <AlertTriangle className="size-3" />
              не отправлено
            </span>
          )}
          {out && <span>{m.auto ? "автоматически" : (m.sent_by_name ?? "")}</span>}
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
}

function Attachment({ attachment: a }: { attachment: CrmAttachment }) {
  const { data: url } = useQuery({
    queryKey: ["crm-file", a.path],
    queryFn: () => crmFileUrl(a.path),
    enabled: !!a.path,
    staleTime: 50 * 60_000,
  });
  if (!a.path) return <p className="text-xs text-muted-foreground italic">{a.name}</p>;
  if (a.kind === "image")
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        <img src={url} alt={a.name} className="max-h-64 rounded-lg object-contain" loading="lazy" />
      </a>
    ) : (
      <Skeleton className="mb-1 h-40 w-56 rounded-lg" />
    );
  if (a.kind === "audio" && url)
    return <audio controls src={url} className="mb-1 h-10 max-w-full" />;
  if (a.kind === "video" && url)
    return <video controls src={url} className="mb-1 max-h-64 rounded-lg" preload="metadata" />;
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 rounded-lg bg-background/60 px-2 py-1.5 hover:bg-background"
    >
      <FileText className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{a.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{fileSize(a.size)}</span>
    </a>
  );
}

function Composer({
  conversationId,
  contactName,
  studioName,
}: {
  conversationId: string;
  contactName?: string | null;
  studioName?: string | null;
}) {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery(crmTemplatesQuery);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const send = async () => {
    if (sending || (!body.trim() && !file)) return;
    setSending(true);
    try {
      await sendCrmMessage(conversationId, body.trim(), file);
      setBody("");
      setFile(null);
      await qc.invalidateQueries({ queryKey: [CRM_KEY, "messages", conversationId] });
      void qc.invalidateQueries({ queryKey: [CRM_KEY, "conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t bg-background p-2 sm:px-4 sm:py-3">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm">
          <Paperclip className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-xs text-muted-foreground">{fileSize(file.size)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Убрать файл"
            onClick={() => setFile(null)}
          >
            <X />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f && f.size > MAX_FILE) {
              toast.error("Файл больше 20 МБ");
              return;
            }
            setFile(f);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Прикрепить файл"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
        </Button>
        {templates.length > 0 && (
          <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Шаблоны ответов"
                title="Шаблоны ответов"
              >
                <FileText />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-80 overflow-y-auto p-1">
              {templates.map((t) => (
                <ListItemButton
                  key={t.id}
                  onClick={() => {
                    setBody(fillTemplate(t.body, { name: contactName, studio: studioName }));
                    setTemplatesOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t.body}</span>
                  </span>
                </ListItemButton>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <Textarea
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Сообщение клиенту. Enter — отправить, Shift+Enter — новая строка"
          aria-label="Сообщение клиенту"
          className="max-h-40 min-h-10 flex-1 resize-none"
        />
        <Button
          size="icon"
          aria-label="Отправить"
          disabled={sending || (!body.trim() && !file)}
          onClick={() => void send()}
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
}
