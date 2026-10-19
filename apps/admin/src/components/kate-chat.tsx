import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Cat,
  ChevronLeft,
  History,
  Loader2,
  MessageCirclePlus,
  Mic,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { ListItemButton } from "@/components/ui/list-item-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ClientNameLink } from "@/components/client-name-link";
import { useConfirm } from "@/components/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { activeStudioHeaders } from "@/hooks/use-active-studio";
import { fromStored, MAX_QUESTION_CHARS } from "@/lib/assistant/history";
import { formatDateTime } from "@/lib/format";
import { unwrap } from "@/lib/query";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
type Thread = { id: string; title: string; updated_at: string };

/**
 * Диалоги сотрудника с Kate (assistant_threads, RLS — только свои), новые
 * сверху. Сообщения пишет сервер (/api/chat), окно их только читает.
 */
const threadsQueryKey = ["assistant_threads"] as const;

const SUGGESTIONS = [
  "Кому позвонить сегодня, чтобы продать больше?",
  "У кого заканчивается абонемент в ближайшие 2 недели?",
  "Кто был на пробном в этом месяце и не купил?",
  "Кто недавно зарегистрировался в приложении?",
];

export function KateChat({
  heightClass = "h-[calc(100dvh-8rem)]",
  fullscreenOnMobile = false,
}: {
  heightClass?: string;
  /** Окно во весь экран на телефоне: без скруглений и рамки, место под крестик. */
  fullscreenOnMobile?: boolean;
}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<"chat" | "history">("chat");
  const [busy, setBusy] = useState(false);
  // Открытый диалог. fresh — ещё не сохранён (новый чат): сообщений в базе
  // нет, загружать нечего. Выбирается один раз — после этого обновление
  // списка диалогов не пересоздаёт идущий разговор.
  const [active, setActive] = useState<{ id: string; fresh: boolean } | null>(null);

  const threads = useQuery({
    queryKey: threadsQueryKey,
    queryFn: () =>
      unwrap<Thread[]>(
        supabase
          .from("assistant_threads")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
      ),
    meta: { errorMessage: "Не удалось загрузить историю переписки с Kate" },
  });

  // При открытии — последний диалог: переписка продолжается с того же места.
  useEffect(() => {
    if (active || !threads.data) return;
    const last = threads.data[0];
    setActive(last ? { id: last.id, fresh: false } : { id: crypto.randomUUID(), fresh: true });
  }, [active, threads.data]);
  // Историю не загрузить — всё равно можно начать новый чат.
  useEffect(() => {
    if (!active && threads.isError) setActive({ id: crypto.randomUUID(), fresh: true });
  }, [active, threads.isError]);

  const messages = useQuery({
    queryKey: ["assistant_messages", active?.id],
    queryFn: async () => {
      const rows = await unwrap<{ id: string; role: string; parts: unknown }[]>(
        supabase
          .from("assistant_messages")
          .select("id, role, parts")
          .eq("thread_id", active!.id)
          .order("created_at", { ascending: true })
          .limit(500),
      );
      return rows.map(fromStored).filter((m): m is UIMessage => !!m);
    },
    enabled: !!active && !active.fresh,
    // Сообщения живут в useChat; при каждом открытии диалога — свежие из базы.
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    meta: { errorMessage: "Не удалось загрузить переписку с Kate" },
  });

  const startNew = () => {
    setActive({ id: crypto.randomUUID(), fresh: true });
    setView("chat");
  };

  const openThread = (id: string) => {
    if (id !== active?.id) setActive({ id, fresh: false });
    setView("chat");
  };

  const deleteThread = async (t: Thread) => {
    if (
      !(await confirm({ title: "Удалить диалог?", description: `«${t.title}» удалится насовсем.` }))
    )
      return;
    const { error } = await supabase.from("assistant_threads").delete().eq("id", t.id);
    if (error) {
      toast.error("Не удалось удалить диалог: " + error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: threadsQueryKey });
    if (t.id === active?.id) startNew();
  };

  const activeTitle =
    active && !active.fresh ? threads.data?.find((t) => t.id === active.id)?.title : null;
  const ready = !!active && (active.fresh || messages.isSuccess || messages.isError);

  return (
    <div
      className={`relative isolate mx-auto ${heightClass} w-full max-w-3xl rounded-lg ${busy ? "ai-thinking-glow" : ""}`}
    >
      <div
        className={`relative z-10 flex h-full flex-col overflow-hidden rounded-lg border bg-background ${fullscreenOnMobile ? "max-md:rounded-none max-md:border-0" : ""}`}
      >
        <div
          className={cn(
            "flex min-h-14 items-center gap-2 border-b px-3 py-2",
            // Справа на телефоне — крестик окна.
            fullscreenOnMobile && "max-md:pr-14",
          )}
        >
          {view === "history" ? (
            <Button variant="ghost" size="sm" onClick={() => setView("chat")}>
              <ChevronLeft /> К диалогу
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView("history")}
              aria-label="История диалогов"
            >
              <History /> История
            </Button>
          )}
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {view === "history" ? "Диалоги с Kate" : (activeTitle ?? "Новый чат")}
          </p>
          <Button variant="ghost" size="sm" onClick={startNew} disabled={busy && view === "chat"}>
            <MessageCirclePlus /> <span className="max-sm:hidden">Новый чат</span>
          </Button>
        </div>

        {view === "history" ? (
          <ThreadList
            threads={threads.data}
            loading={threads.isPending}
            activeId={active?.id ?? null}
            onOpen={openThread}
            onDelete={deleteThread}
          />
        ) : ready && active ? (
          <ChatSession
            key={active.id}
            threadId={active.id}
            initialMessages={messages.data ?? []}
            onBusyChange={setBusy}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: threadsQueryKey })}
          />
        ) : (
          <ChatSkeleton />
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

function ThreadList({
  threads,
  loading,
  activeId,
  onOpen,
  onDelete,
}: {
  threads: Thread[] | undefined;
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (t: Thread) => void;
}) {
  if (loading) {
    return (
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (!threads?.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Диалогов пока нет
      </div>
    );
  }
  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-3">
      {threads.map((t) => (
        <div key={t.id} className="group flex items-center gap-1">
          <ListItemButton
            active={t.id === activeId}
            onClick={() => onOpen(t.id)}
            className="flex-1"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t.title}</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {formatDateTime(t.updated_at)}
              </span>
            </span>
          </ListItemButton>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(t)}
            aria-label={`Удалить диалог «${t.title}»`}
            title="Удалить диалог"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ChatSkeleton() {
  return (
    <>
      <div className="flex-1 space-y-4 overflow-hidden p-4 sm:p-6">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-2/5 rounded-lg" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-24 w-3/4 rounded-lg" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-1/3 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-2 border-t p-3">
        <Skeleton className="h-20 flex-1" />
        <Skeleton className="h-20 w-10" />
      </div>
    </>
  );
}

function ChatSession({
  threadId,
  initialMessages,
  onBusyChange,
  onSaved,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onBusyChange: (busy: boolean) => void;
  /** Ответ готов — сервер сохранил диалог (заголовок и порядок в списке). */
  onSaved: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // Историю сервер берёт из базы — отправляем только новый вопрос.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { threadId: id, message: messages[messages.length - 1] },
        }),
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          for (const [k, v] of Object.entries(activeStudioHeaders())) headers.set(k, v);
          const response = await fetch(url, { ...init, headers });
          if (response.ok) return response;

          const contentType = response.headers.get("content-type") ?? "";
          const body = await response
            .clone()
            .text()
            .catch(() => "");
          const isHtmlError =
            contentType.includes("text/html") || body.trimStart().startsWith("<!doctype");
          return new Response(
            isHtmlError ? "Сервис ассистента временно недоступен. Попробуйте ещё раз." : body,
            { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (err) => toast.error(formatAssistantError(err)),
    onFinish: () => onSaved(),
  });

  const isLoading = status === "submitted" || status === "streaming";
  useEffect(() => onBusyChange(isLoading), [isLoading, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const sendText = async (text: string) => {
    try {
      await sendMessage({ text });
    } catch (err) {
      console.error("[assistant] send failed", err);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    if (text.length > MAX_QUESTION_CHARS) {
      toast.error(`Вопрос длиннее ${MAX_QUESTION_CHARS} символов — сократите его`);
      return;
    }
    setInput("");
    void sendText(text);
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <div className="ai-gradient flex h-14 w-14 items-center justify-center rounded-full text-white">
              <Cat className="h-7 w-7" />
            </div>
            <div>
              <p className="text-base font-medium text-foreground">Привет! Я Kate.</p>
              <p className="mt-1 text-sm">
                Подскажу, кому позвонить и что предложить: продления, пробные, должники, новые
                клиенты в приложении.
              </p>
            </div>
            <div className="mt-4 grid w-full max-w-md gap-2 text-left text-sm">
              {SUGGESTIONS.map((s) => (
                <ChoiceCard key={s} compact onClick={() => sendText(s)}>
                  {s}
                </ChoiceCard>
              ))}
            </div>
          </div>
        )}
        {messages.map((m: UIMessage) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Kate думает…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Ошибка: {error.message}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t p-3"
      >
        <div className="flex items-start gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Напишите вопрос Kate…"
            rows={2}
            className="min-h-[80px] resize-none flex-1"
          />
          <div className="flex h-[80px] items-center gap-2">
            <VoiceInputButton
              disabled={isLoading}
              onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text).trim())}
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              aria-label="Отправить"
            >
              <Send />
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

function formatAssistantError(error: Error) {
  const message = error.message.trim();
  if (!message || message.startsWith("<!doctype") || message.includes("Страница не загрузилась")) {
    return "Сервис ассистента временно недоступен. Попробуйте ещё раз.";
  }
  return message;
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  // Идёт запрос к данным: последняя часть — вызов инструмента без текста после.
  const last = message.parts[message.parts.length - 1];
  const fetching = !isUser && !!last?.type?.startsWith("tool-");
  if (!isUser && !text && !fetching) return null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 rounded-lg px-4 py-2 text-sm ${
          isUser
            ? "max-w-[85%] bg-primary text-primary-foreground"
            : // Ответ с таблицей на телефоне — во всю ширину.
              "max-w-full bg-muted text-foreground md:max-w-[85%]"
        }`}
      >
        {fetching && <div className="mb-2 text-xs text-muted-foreground">🔧 запрос к данным…</div>}
        {isUser ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:my-2 prose-table:my-0 prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              disallowedElements={MARKDOWN_DISALLOWED}
              components={MARKDOWN_COMPONENTS}
              urlTransform={markdownUrl}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

/** Ссылка на карточку клиента в ответе Kate: `[Фамилия Имя](client:<uuid>)`. */
const CLIENT_LINK_RE = /^client:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Своя схема client: проходит как есть, остальное — стандартная очистка. */
function markdownUrl(url: string) {
  return CLIENT_LINK_RE.test(url) ? url : defaultUrlTransform(url);
}

/**
 * Ответ модели — недоверенный текст: в него может попасть инъекция из данных
 * (имена, заметки клиентов). Картинки не рендерим — браузер сам загрузил бы
 * URL и унёс бы в его параметрах данные из чата; ссылки открываются только
 * по клику, в новой вкладке и без Referer/opener. Ссылка client: открывает
 * карточку клиента — RLS отдаст её, только если сотруднику она видна.
 */
const MARKDOWN_DISALLOWED = ["img"];
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const client = href ? CLIENT_LINK_RE.exec(href) : null;
    if (client) {
      return (
        <ClientNameLink clientId={client[1]} className="whitespace-normal">
          {children}
        </ClientNameLink>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Широкая таблица прокручивается внутри сообщения, а не раздвигает окно.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="my-0">{children}</table>
    </div>
  ),
};

/** Выключает микрофон: пока дорожки потока живы, браузер держит его занятым. */
function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function VoiceInputButton({
  disabled,
  onTranscribed,
}: {
  disabled?: boolean;
  onTranscribed: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);

  // Окно Kate могут закрыть посреди записи: без этого запись продолжалась, а
  // микрофон оставался включённым, пока не закроют вкладку.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        // Недописанную запись на распознавание не отправляем.
        rec.onstop = null;
        rec.stop();
      }
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const start = async () => {
    if (disabled || busy) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Нужен доступ к микрофону");
      return;
    }
    // Окно закрыли, пока браузер спрашивал доступ, — микрофон сразу гасим.
    if (!mountedRef.current) {
      stopTracks(stream);
      return;
    }
    const mimeType = ["audio/webm", "audio/mp4"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    );
    if (!mimeType) {
      stopTracks(stream);
      toast.error("Браузер не поддерживает запись аудио");
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stopTracks(stream);
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      if (blob.size < 1024) {
        toast.error("Запись пустая, попробуйте ещё раз");
        return;
      }
      setBusy(true);
      try {
        const ext = rec.mimeType.includes("mp4") ? "mp4" : "webm";
        const fd = new FormData();
        fd.append("file", blob, `recording.${ext}`);
        // Эндпоинт распознавания пускает только сотрудников, поэтому токен
        // обязателен — как и в транспорте чата выше.
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: fd,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...activeStudioHeaders(),
          },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { text?: string };
        const text = (data.text ?? "").trim();
        if (text) onTranscribed(text);
        else toast.error("Не удалось распознать речь");
      } catch (err) {
        toast.error(`Ошибка распознавания: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    };
    recorderRef.current = rec;
    streamRef.current = stream;
    rec.start();
    setRecording(true);
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  };

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      size="icon"
      disabled={disabled || busy}
      onClick={recording ? stop : start}
      title={recording ? "Закончить запись" : "Голосовой ввод"}
      aria-label={recording ? "Закончить запись" : "Голосовой ввод"}
    >
      {busy ? <Loader2 className="animate-spin" /> : recording ? <Square /> : <Mic />}
    </Button>
  );
}
