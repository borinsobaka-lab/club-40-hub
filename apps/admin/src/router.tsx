import { createRouter } from "@tanstack/react-router";

import { PageSkeleton } from "./components/skeletons";
import { createQueryClient } from "./lib/query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = createQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Пока грузится код страницы — скелетон на её месте (меню остаётся, оно
    // в layout-роуте). По умолчанию роутер ждёт секунду и всё это время
    // держит прежнюю страницу без признаков перехода; 200 мс — не мигает
    // на быстрых переходах, 300 мс показа — не дёргается, если успел появиться.
    defaultPendingComponent: PageSkeleton,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
  });

  return router;
};
