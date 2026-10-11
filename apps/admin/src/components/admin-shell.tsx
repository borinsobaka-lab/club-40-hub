import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cat, RefreshCw, X } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { StudioSwitcher } from "@/components/studio-switcher";
import { Button } from "@/components/ui/button";
import { KateChat } from "@/components/kate-chat";

export function AdminShell({
  title,
  actions,
  canvas = "default",
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** Подложка рабочей области: обычная (--canvas) или белая (расписание пакетных студий). */
  canvas?: "default" | "white";
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

        Узкий экран (до lg): первая строка — меню, заголовок, «Обновить», Kate;
        действия страницы уходят второй строкой на всю ширину (order-last +
        w-full), а выбор студии и «Выйти» — в низ бокового меню (AppSidebar).
        Действия рендерятся один раз и только переезжают: внутри них бывают
        диалоги со своим состоянием, второй экземпляр открыл бы окно дважды.
      */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 lg:h-16 lg:flex-nowrap lg:gap-3 lg:px-4 lg:py-0">
        {/*
          На узком экране боковое меню уходит в шторку и кнопка сворачивания
          внутри него недоступна — открыть меню больше нечем.
        */}
        <SidebarTrigger className="-ml-1 size-10 md:hidden" />
        {/*
          Заголовок раздела: font-semibold — тот же вес, что у заголовков
          диалогов и карточек, и он же прописан в дизайн-системе как вес
          ведущего элемента. Трекинг не задаём руками: он зашит в токен
          --text-2xl--letter-spacing. leading-tight обязателен — заголовок под
          truncate, а у «Промокодов» и «Пуш-уведомлений» есть выносные
          элементы (р, у), их бы срезало. На телефоне ступенью меньше (xl):
          в 2xl «Отмены автопродления» не помещались рядом с кнопками.
        */}
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight lg:flex-initial lg:text-2xl">
          {title}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Обновить"
          className="shrink-0"
          onClick={() => {
            router.invalidate();
            queryClient.invalidateQueries();
          }}
        >
          <RefreshCw className="h-5 w-5" />
        </Button>

        {actions && (
          <div className="shell-actions order-last w-full lg:order-none lg:ml-auto lg:w-auto">
            {actions}
          </div>
        )}

        <button
          type="button"
          onClick={() => setKateOpen(true)}
          aria-label="Kate — AI ассистент"
          className={`ai-gradient group relative inline-flex h-10 shrink-0 items-center gap-2 overflow-hidden rounded-md px-3 text-sm font-medium text-white transition lg:h-9 ${actions ? "" : "lg:ml-auto"}`}
        >
          <Cat className="h-4 w-4" />
          <span className="max-sm:hidden">Kate</span>
        </button>
        <div className="hidden items-center gap-2 lg:flex">
          <StudioSwitcher />
          <SignOutButton />
        </div>
      </header>
      {/* На телефоне поля рабочей области уже: p-6 съедал 48px из 390. */}
      <main
        className={`flex-1 overflow-auto p-3 sm:p-4 lg:p-6 ${canvas === "white" ? "bg-background" : ""}`}
      >
        {children}
      </main>

      <DialogPrimitive.Root open={kateOpen} onOpenChange={setKateOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          {/* На телефоне чат — во весь экран: в окне 80vh клавиатура съедала ленту. */}
          <DialogPrimitive.Content className="fixed inset-0 z-50 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:inset-auto md:left-1/2 md:top-1/2 md:w-[calc(100vw-2rem)] md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95">
            <DialogPrimitive.Title className="sr-only">Kate — AI ассистент</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Спросите Kate о клиентах, тренерах, расписании или абонементах.
            </DialogPrimitive.Description>
            <KateChat heightClass="h-dvh md:h-[min(80vh,720px)]" fullscreenOnMobile />
            {/* Во весь экран подложки не видно — закрыть окно иначе нечем. */}
            <DialogPrimitive.Close className="absolute right-2 top-2 z-20 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden">
              <X className="h-5 w-5" />
              <span className="sr-only">Закрыть</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
