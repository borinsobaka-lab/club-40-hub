import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({ meta: [{ title: "Kate — AI ассистент" }] }),
  component: AssistantPage,
});

function AssistantPage() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    fetch: async (url, init) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
  });

  const { messages, sendMessage, status, error } = useChat({
    transport,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isLoading = status === "submitted" || status === "streaming";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ text });
  };

  return (
    <AdminShell title="KATE — AI АССИСТЕНТ">
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-lg border bg-background">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-500 text-white">
                <Sparkles className="h-7 w-7" />
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
          <div className="flex items-end gap-2">
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
              rows={1}
              className="min-h-[40px] resize-none"
            />
            <Button type="submit" disabled={isLoading || !input.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
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
