import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STAFF_ITEMS } from "@/lib/nav-sections";

/**
 * Вкладки раздела «Сотрудники» (пункт блока «Клуб» в меню клуба, решение
 * владельца 2026-10-13): «Сотрудники», «Зарплаты», «График», «Ставки» —
 * отдельные страницы, вкладка переключает страницу. Стоит первой на каждой
 * из них; скелетон — `StaffTabsSkeleton` в page-skeletons.tsx.
 *
 * activationMode="manual": стрелки только двигают фокус, переход — по клику,
 * Enter или пробелу (иначе каждая стрелка открывала бы страницу).
 */
export function StaffTabs({ className }: { className?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = STAFF_ITEMS.find((i) => pathname === i.url)?.url ?? STAFF_ITEMS[0].url;

  return (
    <Tabs
      value={current}
      onValueChange={(url) => navigate({ to: url })}
      activationMode="manual"
      className={className}
    >
      {/* На узком экране вкладки не помещаются в строку — прокручиваются. */}
      <TabsList
        aria-label="Разделы сотрудников"
        className="max-w-full justify-start overflow-x-auto"
      >
        {STAFF_ITEMS.map((item) => (
          <TabsTrigger
            key={item.url}
            value={item.url}
            title={item.title}
            // Чанк страницы — заранее, как у ссылок меню (defaultPreload: "intent").
            onMouseEnter={() => router.preloadRoute({ to: item.url }).catch(() => {})}
          >
            {item.tab}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
