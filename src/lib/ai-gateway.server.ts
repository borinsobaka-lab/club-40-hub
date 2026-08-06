import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// AI-провайдер пока не подключён: Lovable AI Gateway отключён при переезде,
// новый провайдер ещё не выбран. Пока переменные ниже не заданы, /api/chat и
// /api/transcribe отвечают 503 «временно недоступно».
//
// Чтобы включить ассистента и диктовку, задайте в окружении любой
// OpenAI-совместимый API:
//   AI_GATEWAY_BASE_URL — например https://api.openai.com/v1
//   AI_GATEWAY_API_KEY  — ключ провайдера
//   AI_CHAT_MODEL       — модель чата (например gpt-4.1-mini)
//   AI_TRANSCRIBE_MODEL — модель распознавания речи (например gpt-4o-mini-transcribe)

export function getAiGatewayConfig() {
  const baseURL = process.env.AI_GATEWAY_BASE_URL;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!baseURL || !apiKey) return null;
  return { baseURL: baseURL.replace(/\/+$/, ""), apiKey };
}

export function createAiProvider() {
  const config = getAiGatewayConfig();
  if (!config) return null;
  return createOpenAICompatible({
    name: "ai-gateway",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}
