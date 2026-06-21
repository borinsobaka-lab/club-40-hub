import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Cat, Send, Loader2, Mic, Square } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({ meta: [{ title: "Kate — AI ассистент" }] }),
  component: AssistantPage,
});

function AssistantPage() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          const response = await fetch(url, { ...init, headers });
          if (response.ok) return response;

          const contentType = response.headers.get("content-type") ?? "";
          const body = await response.clone().text().catch(() => "");
          const isHtmlError = contentType.includes("text/html") || body.trimStart().startsWith("<!doctype");
          return new Response(
            isHtmlError ? "Сервис ассистента временно недоступен. Попробуйте ещё раз." : body,
            { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    onError: (err) => toast.error(formatAssistantError(err)),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isLoading = status === "submitted" || status === "streaming";

  const sendText = async (text: string) => {
    try {
      await sendMessage({ text });
    } catch (err) {
      console.error("[assistant] send failed", err);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendText(text);
  };

  return (
    <AdminShell title="KATE — AI АССИСТЕНТ">
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-lg border bg-background">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-500 text-white">
                <Cat className="h-7 w-7" />
              </div>
              <div>
                <p className="text-base font-medium text-foreground">Привет! Я Kate.</p>
                <p className="mt-1 text-sm">
                  Спросите про клиентов, тренеров, расписание или абонементы.
                </p>
              </div>
              <div className="mt-4 grid w-full max-w-md gap-2 text-left text-sm">
                {[
                  "Во сколько и по каким дням на этой неделе кардио-тренировки?",
                  "У скольких клиентов заканчивается абонемент?",
                  "Какие клиенты зарегистрировались на этой неделе?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage({ text: s })}
                    className="rounded-md border bg-muted/30 px-3 py-2 text-foreground transition hover:bg-muted"
                  >
                    {s}
                  </button>
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
        <form onSubmit={onSubmit} className="border-t p-3">
          <div className="flex items-start gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Напишите вопрос Kate…"
              rows={2}
              className="min-h-[80px] resize-none flex-1"
            />
            <div className="flex h-[80px] items-center gap-2">
              <VoiceInputButton
                disabled={isLoading}
                onTranscribed={(text) =>
                  setInput((prev) => (prev ? `${prev} ${text}` : text).trim())
                }
              />
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                size="icon"
                className="h-10 w-10"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </AdminShell>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  const toolParts = message.parts.filter((p) => p.type?.startsWith("tool-"));

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {!isUser && toolParts.length > 0 && (
          <div className="mb-2 text-xs text-muted-foreground">
            🔧 запрос к данным…
          </div>
        )}
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
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

  const start = async () => {
    if (disabled || busy) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Нужен доступ к микрофону");
      return;
    }
    const mimeType = ["audio/webm", "audio/mp4"].find((t) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    );
    if (!mimeType) {
      stream.getTracks().forEach((t) => t.stop());
      toast.error("Браузер не поддерживает запись аудио");
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
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
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
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
      className="h-10 w-10"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <Square className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
