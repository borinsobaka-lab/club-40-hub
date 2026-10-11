import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Данные с экрана, который только что открывали, показываются сразу и
        // обновляются фоном не чаще раза в 30 секунд — переходы между
        // разделами без скелетонов и лишних запросов.
        staleTime: 30_000,
        // Кэш держим сутки: он же сохраняется в браузере между запусками
        // (src/lib/query-persist.ts).
        gcTime: 24 * 60 * 60_000,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: false,
    // Код раздела подгружается при наведении/касании ссылки, до перехода.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
