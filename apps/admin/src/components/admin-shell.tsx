import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cat, RefreshCw, X } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { StudioSwitcher } from "@/components/studio-switcher";
import { Button } from "@/components/ui/button";
import { KateChat } from "@/components/kate-chat";
import { HeaderClientSearch } from "@/components/header-client-search";

/**
 * Действия страницы («Продажа», «Добавить тренировку»…) — крупные кнопки,
 * плавающие в правом нижнем углу рабочей области. AdminShell ставит сюда
 * свой проп `actions`; раздел, где действие зависит от таба («Прочие
 * продажи»), рендерит FloatingActions сам — где угодно внутри страницы.
 * Размер и тень кнопок — `.fab-actions` в styles.css: на месте кнопкам
 * размер не задаём, там же запас снизу у main.
 * Рендерить один раз: внутри бывают диалоги со своим состоянием.
 */
export function FloatingActions({ children }: { children: ReactNode }) {
  return (
    <div className="fab-actions fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-end gap-3 sm:right-6 sm:bottom-6 lg:right-8 lg:bottom-8">
      {children}
    </div>
  );
}

export function AdminShell({
  title,
  actions,
  children,
}: {
  title: string;
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

        С lg — три части: слева заголовок и «Обновить», по центру поиск
        клиента, справа Kate и выбор клуба. Левая и правая части одинаково
        тянутся (flex-1 basis-0), поэтому поиск стоит ровно посередине, пока
        им хватает места. Узкий экран (до lg): первая строка — меню,
        заголовок, «Обновить», Kate; поиск — второй строкой на всю ширину, а
        выбор клуба — в низ бокового меню (AppSidebar).
        Действия страницы в шапку больше не ставим — они плавают в правом
        нижнем углу (FloatingActions).
      */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 lg:h-16 lg:flex-nowrap lg:gap-3 lg:px-4 lg:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:basis-0">
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
          <h1 className="min-w-0 truncate text-xl font-semibold leading-tight lg:text-2xl">
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
        </div>

        <HeaderClientSearch className="order-last w-full lg:order-none lg:w-auto lg:min-w-56 lg:flex-[0_1_30rem]" />

        <div className="flex shrink-0 items-center justify-end gap-2 lg:flex-1 lg:basis-0">
          <button
            type="button"
            onClick={() => setKateOpen(true)}
            aria-label="Kate — AI ассистент"
            className="ai-gradient group relative inline-flex h-10 shrink-0 items-center gap-2 overflow-hidden rounded-md px-3 text-sm font-medium text-white transition lg:h-9"
          >
            <Cat className="h-4 w-4" />
            <span className="max-sm:hidden">Kate</span>
          </button>
          {/* «Выход» — в рейке слева, под аватаркой сотрудника (RailAccount). */}
          <div className="hidden items-center gap-2 lg:flex">
            <StudioSwitcher />
          </div>
        </div>
      </header>
      {/*
        На телефоне поля рабочей области уже: p-6 съедал 48px из 390.
        admin-main: пока на странице есть плавающие действия, снизу добавляется
        запас (styles.css) — последняя строка таблицы и пагинация
        прокручиваются из-под кнопок.
      */}
      <main className="admin-main flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        {children}
        {actions && <FloatingActions>{actions}</FloatingActions>}
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
