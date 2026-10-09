import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cat, RefreshCw } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { StudioSwitcher } from "@/components/studio-switcher";
import { Button } from "@/components/ui/button";
import { triggerRefresh } from "@/lib/refresh-bus";
import { KateChat } from "@/components/kate-chat";

export function AdminShell({
  title,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [kateOpen, setKateOpen] = useState(false);

  return (
    <>
      {/*
        Шапка сплошная белая: она не перекрывает прокручиваемый контент (main —
        соседний блок), поэтому полупрозрачность только подмешивала подложку и
        размывала границу между шапкой и рабочей областью.
      */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4">
        <div className="flex flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/*
              На узком экране боковое меню уходит в шторку и кнопка сворачивания
              внутри него недоступна — открыть меню больше нечем.
            */}
            <SidebarTrigger className="md:hidden" />
            {/*
              Заголовок раздела: font-semibold — тот же вес, что у заголовков
              диалогов и карточек, и он же прописан в дизайн-системе как вес
              ведущего элемента. Трекинг не задаём руками: он зашит в токен
              --text-2xl--letter-spacing. leading-tight обязателен — заголовок
              под truncate, а у «Промокодов» и «Пуш-уведомлений» есть выносные
              элементы (р, у), их бы срезало.
            */}
            <h1 className="truncate text-2xl font-semibold leading-tight">{title}</h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Обновить"
              onClick={() => {
                router.invalidate();
                queryClient.invalidateQueries();
                triggerRefresh();
              }}
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setKateOpen(true)}
              className="ai-gradient group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-md px-3 text-sm font-medium text-white transition"
            >
              <Cat className="h-4 w-4" />
              <span>Kate</span>
            </button>
            <StudioSwitcher />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-6">{children}</main>

      <DialogPrimitive.Root open={kateOpen} onOpenChange={setKateOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <DialogPrimitive.Title className="sr-only">Kate — AI ассистент</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Спросите Kate о клиентах, тренерах, расписании или абонементах.
            </DialogPrimitive.Description>
            <KateChat heightClass="h-[min(80vh,720px)]" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
