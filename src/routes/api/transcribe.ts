import { createFileRoute } from "@tanstack/react-router";

import { getAiGatewayConfig } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const config = getAiGatewayConfig();
          const model = process.env.AI_TRANSCRIBE_MODEL;
          if (!config || !model) {
            return new Response(
              "Распознавание речи временно недоступно: после переезда новый AI-провайдер ещё не подключён.",
              { status: 503 },
            );
          }

          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
            return new Response("Нужен аудиофайл", { status: 400 });
          }

          const inForm = await request.formData();
          const file = inForm.get("file");
          if (!(file instanceof File) || file.size === 0) {
            return new Response("Запись пустая", { status: 400 });
          }

          const upstream = new FormData();
          upstream.append("model", model);
          const type = file.type.split(";")[0];
          const ext =
            ({ "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" } as Record<string, string>)[type] ?? "webm";
          upstream.append("file", file, `recording.${ext}`);

          const res = await fetch(`${config.baseURL}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: upstream,
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return new Response(text || "Не удалось распознать речь", { status: res.status });
          }
          const data = (await res.json()) as { text?: string };
          return new Response(JSON.stringify({ text: data.text ?? "" }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("[api/transcribe] request failed", error);
          return new Response("Не удалось распознать речь", { status: 500 });
        }
      },
    },
  },
});
