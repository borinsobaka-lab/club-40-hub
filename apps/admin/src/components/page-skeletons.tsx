import { useSyncExternalStore, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Info, Wallet, Zap } from "lucide-react";

import {
  ShellSkeleton,
  TableCardSkeleton,
  TableSkeletonRows,
  ToolbarSkeleton,
  type ControlSkeleton,
  type HeaderSkeleton,
} from "@/components/skeletons";
import { FieldHint } from "@/components/ui/field-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/format";
import { defaultPeriod, periodLabel, type PeriodKey } from "@/lib/payroll";
import type { StudioFormat } from "@/lib/studio-formats";
import {
  SCHEDULE_SKELETON_HOURS,
  isScheduleSkeletonCell,
  readSkeletonFormat,
} from "@/lib/page-skeleton-layout";
import {
  CLIENTS_CHARTS,
  CLIENTS_GRID,
  CLIENTS_STATS,
  DASHBOARD_CHART_HEIGHT,
  DASHBOARD_FILTERS,
  DASHBOARD_PIE_HEIGHT,
  DASHBOARD_RANK_HEIGHT,
  DASHBOARD_TITLES,
  OVERVIEW_CHARTS,
  OVERVIEW_GRID,
  OVERVIEW_STATS,
  SALES_CHARTS,
  SALES_GRID,
  SALES_STATS,
} from "@/lib/dashboard-stats";

/*
 * Скелетоны страниц админки — по одному на раздел, каждый повторяет
 * структуру СВОЕЙ страницы: заголовок, плавающие кнопки действий, плашку фильтров с теми
 * же контролами, заголовки колонок, плитки, карточки, вкладки. Статичные
 * подписи (вкладки, колонки, названия плиток) — настоящим текстом, болванки
 * — только на месте данных.
 *
 * Кто показывает: `pendingComponent` роута (пока грузится код страницы), а
 * через RoutePendingSkeleton — AccessGate, каркас до входа и RequireFormat.
 * Тела-скелетоны (ScriptsListSkeleton, NpsSurveysSkeleton…) страницы берут
 * и для своих данных — тогда переход «скелетон роута → страница грузит
 * данные → данные» идёт без смены раскладки.
 *
 * Модуль попадает в основной бандл (pendingComponent не выносится в чанк
 * страницы) — сюда только разметка: без запросов, тяжёлых библиотек и
 * импорта из файлов страниц.
 *
 * Меняешь раскладку страницы (колонку, фильтр, кнопку) — поправь и её
 * скелетон здесь. Правила — .interface-design/system.md, «Скелетоны».
 */

// ---------------------------------------------------------------------------
// Общие кусочки

const noSubscribe = () => () => {};

/**
 * Формат активного клуба для страниц, у которых от него зависит раскладка
 * (колонки «Продаж», «Тренировок», фильтр «Расписания»). Без запроса: из
 * localStorage (его пишет StudioBranding). На сервере и при гидратации —
 * подписочный, чтобы разметка совпала с серверной.
 */
function useSkeletonFormat(): StudioFormat {
  return useSyncExternalStore(noSubscribe, readSkeletonFormat, () => "subscription");
}

/**
 * Вкладки со статичными подписями, активная — как у настоящих Tabs.
 * className — у обёртки (как у корня Tabs: toolbar-full и т. п.), сама
 * плашка не растягивается.
 */
function TabsSkeleton({
  labels,
  active = 0,
  className,
}: {
  labels: string[];
  /** Какая вкладка активна по умолчанию у страницы. */
  active?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="relative inline-flex h-10 items-center justify-center rounded-full bg-muted p-1 text-muted-foreground max-sm:max-w-full">
        {labels.map((label, i) => (
          <span
            key={label}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1 text-sm font-medium",
              i === active && "bg-primary text-primary-foreground",
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Кнопка-иконка (стрелки периода): круг 40×40 с рамкой, как outline icon. */
function IconButtonSkeleton({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground/60">
      {children}
    </span>
  );
}

/** Плитка с настоящей подписью и болванкой значения. */
function StatTileSkeleton({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <Skeleton className="mt-1 h-8 w-16" />
    </div>
  );
}

/** Поле формы: подпись + контрол 40px (или своя высота). */
function FieldSkeleton({ className, control = "h-10" }: { className?: string; control?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className={cn("w-full", control)} />
    </div>
  );
}

/** Табличный раздел: фильтры (если есть) + таблица с подвалом. */
function TablePage({
  title,
  actions,
  toolbar,
  headers,
  pagination = true,
  rows,
  wrap = true,
}: {
  title: string;
  actions?: ControlSkeleton[];
  /** Плашка фильтров: null — у страницы её нет. */
  toolbar: { search?: boolean; controls?: ControlSkeleton[] } | null;
  headers: HeaderSkeleton[];
  pagination?: boolean;
  rows?: number;
  /** false — таблица прямо в main, без контейнера space-y-3. */
  wrap?: boolean;
}) {
  const table = <TableCardSkeleton headers={headers} rows={rows} pagination={pagination} />;
  return (
    <ShellSkeleton title={title} actions={actions}>
      {wrap ? (
        <div className="space-y-3">
          {toolbar && <ToolbarSkeleton {...toolbar} />}
          {table}
        </div>
      ) : (
        table
      )}
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Вход

export function AuthPageSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-background p-6">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-3/4" />
        <FieldSkeleton />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Дашборд

/**
 * Плитки показателей подраздела дашборда — подписи настоящие, болванки на
 * месте значения и сравнения (components/dashboard/stat-cards.tsx).
 */
export function DashboardStatsSkeleton({
  labels,
  className,
}: {
  labels: string[];
  className: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:gap-3", className)}>
      {labels.map((label) => (
        <div key={label} className="rounded-lg border bg-background px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          <Skeleton className="mt-1.5 h-6 w-24" />
          <Skeleton className="mt-1.5 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Панель графика дашборда: настоящий заголовок, болванка графика (components/dashboard/chart-panel.tsx). */
export function DashboardChartSkeleton({
  title,
  height,
  className,
  children,
}: {
  title: string;
  height?: number;
  className?: string;
  /** Своя болванка вместо прямоугольника графика (рейтинг, круговая). */
  children?: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-background p-3 sm:p-4", className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children ?? <Skeleton className="w-full" style={{ height }} />}
    </section>
  );
}

/** «Топ 10»: место, имя с полосой, значение (RankList). */
export function DashboardRankSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2">
          <Skeleton className="h-3 w-3" />
          <div>
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="mt-1 h-1.5 w-full" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Круговая диаграмма с легендой (PiePlot + PieLegend). */
export function DashboardPieSkeleton({ height, rows = 3 }: { height: number; rows?: number }) {
  return (
    <>
      <div className="flex items-center justify-center" style={{ height }}>
        <Skeleton className="aspect-square h-[90%] rounded-full" />
      </div>
      <div className="mt-3 space-y-1.5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </>
  );
}

/**
 * Поле плашки фильтров дашборда с подписью и «?» над ним (решение владельца
 * 2026-10-11: в остальных плашках подписей нет). Ширина — как у фильтра, w-48.
 */
export function DashboardFilterField({
  label,
  tip,
  children,
}: {
  label: string;
  tip: string;
  children: ReactNode;
}) {
  return (
    <div className="grid w-48 gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        <FieldHint>{tip}</FieldHint>
      </span>
      {children}
    </div>
  );
}

/** Плашка фильтров дашборда («Период», «Клубы») и тело подраздела. */
export function DashboardBodySkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="table-toolbar flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2 sm:px-3">
        {[DASHBOARD_FILTERS.period, DASHBOARD_FILTERS.clubs].map((f) => (
          <DashboardFilterField key={f.label} {...f}>
            <Skeleton className="h-10 w-full" />
          </DashboardFilterField>
        ))}
      </div>
      {children}
    </div>
  );
}

/** «Общие показатели»: плитки, выручка по дням, продления и посещения. */
export function DashboardOverviewSkeleton() {
  return (
    <>
      <DashboardStatsSkeleton
        labels={OVERVIEW_STATS.map((s) => s.label)}
        className={OVERVIEW_GRID}
      />
      <DashboardChartSkeleton
        title={OVERVIEW_CHARTS.revenue.title}
        height={DASHBOARD_CHART_HEIGHT}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <DashboardChartSkeleton
          title={OVERVIEW_CHARTS.rates.title}
          height={DASHBOARD_CHART_HEIGHT}
        />
        <DashboardChartSkeleton
          title={OVERVIEW_CHARTS.visits.title}
          height={DASHBOARD_CHART_HEIGHT}
        />
      </div>
    </>
  );
}

export function DashboardPageSkeleton() {
  return (
    <ShellSkeleton title={DASHBOARD_TITLES.overview}>
      <DashboardBodySkeleton>
        <DashboardOverviewSkeleton />
      </DashboardBodySkeleton>
    </ShellSkeleton>
  );
}

/** «Продажи»: плитки, три круговые, два рейтинга. */
export function DashboardSalesSkeleton() {
  return (
    <>
      <DashboardStatsSkeleton labels={SALES_STATS.map((s) => s.label)} className={SALES_GRID} />
      <div className="grid gap-3 lg:grid-cols-3">
        {[SALES_CHARTS.origin, SALES_CHARTS.methods, SALES_CHARTS.subjects].map((c) => (
          <DashboardChartSkeleton key={c.title} title={c.title}>
            <DashboardPieSkeleton height={DASHBOARD_PIE_HEIGHT} />
          </DashboardChartSkeleton>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[SALES_CHARTS.topMemberships, SALES_CHARTS.topSellers].map((c) => (
          <DashboardChartSkeleton key={c.title} title={c.title}>
            <DashboardRankSkeleton />
          </DashboardChartSkeleton>
        ))}
      </div>
    </>
  );
}

export function DashboardSalesPageSkeleton() {
  return (
    <ShellSkeleton title={DASHBOARD_TITLES.sales}>
      <DashboardBodySkeleton>
        <DashboardSalesSkeleton />
      </DashboardBodySkeleton>
    </ShellSkeleton>
  );
}

/** «Клиенты»: плитки, возраст и топ по посещениям, топ по LTV. */
export function DashboardClientsSkeleton() {
  return (
    <>
      <DashboardStatsSkeleton labels={CLIENTS_STATS.map((s) => s.label)} className={CLIENTS_GRID} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DashboardChartSkeleton title={CLIENTS_CHARTS.ages.title} height={DASHBOARD_RANK_HEIGHT} />
        <DashboardChartSkeleton title={CLIENTS_CHARTS.topVisits.title}>
          <DashboardRankSkeleton />
        </DashboardChartSkeleton>
      </div>
      <DashboardChartSkeleton title={CLIENTS_CHARTS.topLtv.title}>
        <DashboardRankSkeleton />
      </DashboardChartSkeleton>
    </>
  );
}

export function DashboardClientsPageSkeleton() {
  return (
    <ShellSkeleton title={DASHBOARD_TITLES.clients}>
      <DashboardBodySkeleton>
        <DashboardClientsSkeleton />
      </DashboardBodySkeleton>
    </ShellSkeleton>
  );
}

/**
 * Подраздел дашборда в разработке («Занятия», «Маркетинг»): данных у него
 * нет, поэтому страница и её скелетон рисуют одно и то же.
 */
export function DashboardSoon() {
  return (
    <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
      Раздел в разработке — показатели появятся здесь позже.
    </div>
  );
}

export function DashboardClassesPageSkeleton() {
  return (
    <ShellSkeleton title={DASHBOARD_TITLES.classes}>
      <DashboardSoon />
    </ShellSkeleton>
  );
}

export function DashboardMarketingPageSkeleton() {
  return (
    <ShellSkeleton title={DASHBOARD_TITLES.marketing}>
      <DashboardSoon />
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Расписание

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7..22, как в schedule.tsx
const SLOT_FULL = 80;
const SLOT_EMPTY = 28;
const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Болванка карточки занятия в слоте сетки. */
export function EntryCardSkeleton() {
  return (
    <div className="pointer-events-none absolute inset-1 space-y-1.5 rounded-md border bg-background p-2">
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

function ScheduleGridSkeleton({ days, packages }: { days: number; packages: boolean }) {
  const single = days === 1;
  return (
    <div className="overflow-auto rounded-lg border bg-background md:max-h-[calc(100dvh-220px)]">
      <div
        className={cn("grid", !single && "min-w-[1200px]")}
        style={{ gridTemplateColumns: `${single ? 52 : 60}px repeat(${days}, minmax(0, 1fr))` }}
      >
        {!single && (
          <>
            <div className="sticky top-0 z-20 border-b border-r bg-background" />
            {DAY_NAMES.map((d) => (
              <div
                key={d}
                className="sticky top-0 z-20 space-y-1 border-b border-r bg-background p-2 text-center text-xs"
              >
                <div className="uppercase tracking-wide text-muted-foreground">{d}</div>
                <Skeleton className="mx-auto h-3 w-10" />
              </div>
            ))}
          </>
        )}
        {HOURS.map((hour) => {
          const height = SCHEDULE_SKELETON_HOURS.has(hour) ? SLOT_FULL : SLOT_EMPTY;
          return (
            <div key={hour} className="contents">
              <div
                className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                style={{ height, lineHeight: "1rem", paddingTop: 4 }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
              {Array.from({ length: days }, (_, di) => (
                <div
                  key={di}
                  className={cn(
                    "relative border-b border-r max-md:border-r-0",
                    packages && "bg-canvas/50",
                  )}
                  style={{ height }}
                >
                  {isScheduleSkeletonCell(hour, di, single) && <EntryCardSkeleton />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SchedulePageSkeleton() {
  const packages = useSkeletonFormat() === "packages";
  return (
    <ShellSkeleton
      title="Расписание"
      actions={[{ label: "Дублировать неделю" }, { label: "Добавить занятие" }]}
    >
      <div className="space-y-3">
        <div className="table-toolbar flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
          <PeriodStepperSkeleton />
          <div className="toolbar-full flex flex-wrap items-center gap-2 sm:ml-auto">
            {!packages && <Skeleton className="h-10 w-40 max-sm:flex-1" />}
            <Skeleton className="h-10 w-[25rem] max-sm:h-[4.5rem] max-sm:w-full" />
            <Skeleton className="h-10 w-48 max-sm:flex-1" />
            <Skeleton className="h-10 w-48 max-sm:flex-1" />
          </div>
        </div>
        {/* Телефон: переключатель дней и сетка одного дня. */}
        <div className="grid grid-cols-7 gap-1 rounded-lg border bg-background p-1 md:hidden">
          {DAY_NAMES.map((d) => (
            <div key={d} className="flex flex-col items-center gap-1 py-1.5 text-xs">
              <span className="uppercase text-muted-foreground">{d}</span>
              <Skeleton className="h-4 w-5" />
            </div>
          ))}
        </div>
        <div className="md:hidden">
          <ScheduleGridSkeleton days={1} packages={packages} />
        </div>
        <div className="max-md:hidden">
          <ScheduleGridSkeleton days={7} packages={packages} />
        </div>
      </div>
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Клуб: клиенты и продажи

export function ClientsPageSkeleton() {
  return (
    <TablePage
      title="Клиенты"
      actions={[{ label: "Добавить клиента" }]}
      // Два фильтра периода (DateRangeFilter) — поля w-48, как селекты.
      toolbar={{ controls: ["w-40", "w-48", "w-48", "w-48"] }}
      headers={[
        { label: "Клиент", className: "min-w-[240px]" },
        { label: "Статус", className: "w-[80px]" },
        "Телефон",
        "Email",
        "Пол",
        "Дата рождения",
        "Регистрация",
        "Последний визит",
        "Заметки",
      ]}
    />
  );
}

export function SalesPageSkeleton() {
  const packages = useSkeletonFormat() === "packages";
  return (
    <TablePage
      title="Продажи"
      actions={[{ label: packages ? "Продажа" : "Новая продажа" }]}
      toolbar={{ controls: packages ? ["w-48"] : [] }}
      headers={[
        { label: "Клиент", className: "min-w-[220px]" },
        "Контакты",
        "Дата",
        "Источник",
        "Абонемент",
        "Статус",
        packages ? "Тип продажи" : "Тип оплаты",
        "Промо-код",
        "Сумма",
        "Первый взнос",
        "Рассрочка",
        "Администратор",
        ...(packages ? ["Тренер"] : []),
        "Комментарий",
      ]}
    />
  );
}

export function ClientMembershipsPageSkeleton() {
  return (
    <TablePage
      title="Абонементы"
      toolbar={{ controls: ["w-48", "w-48"] }}
      headers={[
        { label: "Клиент", className: "min-w-[170px]" },
        "Абонемент",
        "Баланс",
        "Продал / тренер",
        "Комментарии",
        "Платёж 1",
        "Платёж 2",
        "Платёж 3",
      ]}
    />
  );
}

export function OtherSalesPageSkeleton() {
  return (
    <ShellSkeleton title="Прочие продажи" actions={[{ label: "Добавить продажу" }]}>
      <div className="space-y-3">
        <TabsSkeleton labels={["Продажи", "Позиции"]} />
        <TableCardSkeleton
          pagination
          headers={[
            "Позиция",
            "Тип",
            "Клиент",
            { label: "Кол-во", className: "text-right" },
            { label: "Цена", className: "text-right" },
            { label: "Сумма", className: "text-right" },
            "Оплата",
            "Дата",
            "Администратор",
            "Комментарий",
          ]}
        />
      </div>
    </ShellSkeleton>
  );
}

export function BookingsLogPageSkeleton() {
  // «Отметить пропущенные» — только у подписочных клубов.
  const packages = useSkeletonFormat() === "packages";
  return (
    <TablePage
      title="История записей"
      actions={packages ? [] : [{ label: "Отметить пропущенные", icon: false }]}
      toolbar={{ controls: ["w-48"] }}
      headers={[
        { label: "Клиент", className: "min-w-[220px]" },
        "Контакты",
        "Тренировка",
        { label: "Дата и время", className: "w-[160px]" },
        { label: "Статус", className: "w-[140px]" },
        { label: "MET", className: "w-[70px] text-right" },
        { label: "Вес, кг", className: "w-[80px] text-right" },
        { label: "Длит., мин", className: "w-[80px] text-right" },
        { label: "Ккал", className: "w-[90px] text-right" },
        { label: "Отменена", className: "w-[160px]" },
      ]}
    />
  );
}

export function AutorenewPageSkeleton() {
  return (
    <TablePage
      title="Отмены автопродления"
      toolbar={{ controls: ["w-48"] }}
      headers={[
        { label: "Клиент", className: "min-w-[220px]" },
        "Контакты",
        "Абонемент",
        { label: "Действует до", className: "w-[140px]" },
        { label: "Причина отмены", className: "w-[180px]" },
        { label: "Отменено", className: "w-[160px]" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Клуб: номенклатура и справочники

export function MembershipsPageSkeleton() {
  return (
    <TablePage
      title="Номенклатуры"
      actions={[{ label: "Добавить абонемент" }]}
      toolbar={{}}
      headers={[
        { label: "Обложка", className: "w-[80px]" },
        "Название",
        "Описание",
        "Преимущества",
        "Посещения",
        "Срок",
        "Автопродление",
        "Рассрочка",
        "Цена",
        "Статус",
      ]}
    />
  );
}

export function PackagesPageSkeleton() {
  return (
    <TablePage
      title="Номенклатуры"
      actions={[{ label: "Добавить" }]}
      toolbar={{}}
      pagination={false}
      headers={[
        "",
        "Название",
        "Тип",
        "Тренировок",
        "Срок действия",
        "Стоимость",
        "Платежей",
        "Описание",
        "Статус",
      ]}
    />
  );
}

export function PromocodesPageSkeleton() {
  return (
    <TablePage
      title="Промокоды"
      actions={[{ label: "Добавить промокод" }]}
      toolbar={null}
      headers={[
        "Название",
        "Промокод",
        "Скидка",
        "Действует до",
        "Применений",
        "Описание",
        { label: "Активен", className: "w-[100px]" },
      ]}
    />
  );
}

export function WorkoutsPageSkeleton() {
  const packages = useSkeletonFormat() === "packages";
  return (
    <TablePage
      title="Тренировки"
      actions={[{ label: "Добавить тренировку" }]}
      toolbar={{}}
      headers={[
        packages
          ? { label: "Цвет", className: "w-[80px]" }
          : { label: "Иконка", className: "w-[100px]" },
        "Название",
        ...(packages ? [] : [{ label: "Тип", className: "w-[160px]" }]),
        "Описание",
        { label: "Вместимость", className: "w-[120px]" },
        { label: "MET", className: "w-[90px]" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Клуб: финансы

export function CashPageSkeleton() {
  return (
    <ShellSkeleton title="Касса">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-background p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4" />
              Баланс кассы
            </div>
            <Skeleton className="mt-2 h-8 w-32" />
          </div>
        </div>
        <div className="rounded-lg border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold">Новая операция</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton className="sm:col-span-2" />
            <FieldSkeleton className="sm:col-span-2 lg:col-span-6" control="h-16" />
          </div>
          <div className="mt-3 flex justify-end">
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <TableCardSkeleton
          title="История операций"
          pagination
          headers={["Дата", "Тип", "Категория", "Сумма", "Сотрудник", "Комментарий"]}
        />
      </div>
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Клуб: обратная связь

/** Три плитки «Обратной связи» — с подписями, значения грузятся. */
export function FeedbackStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {["В этом месяце", "Не отработано", "Отработано в этом месяце"].map((label) => (
        <StatTileSkeleton key={label} label={label} />
      ))}
    </div>
  );
}

export function FeedbackPageSkeleton() {
  return (
    <ShellSkeleton title="Обратная связь" actions={[{ label: "Добавить" }]}>
      <div className="space-y-3">
        <FeedbackStatsSkeleton />
        <ToolbarSkeleton search={false} controls={["w-48", "w-40", "w-40"]} />
        <TableCardSkeleton
          pagination
          headers={[
            "Дата",
            "Тема",
            "Сообщение",
            { label: "Оценка", className: "w-[80px] text-center" },
            "Имя",
            "Контакт",
            "Статус",
            "Отработал",
          ]}
        />
      </div>
    </ShellSkeleton>
  );
}

/** Вкладка «Опросы» NPS: пять карточек опросов по четыре показателя. */
export function NpsSurveysSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="rounded-lg border bg-background p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mb-4 mt-2 h-3 w-64 max-w-full" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {["NPS", "Ответов", "Промо", "Критики"].map((label) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <Skeleton className="mt-1 h-7 w-12" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Вкладка «Статистика» NPS: фильтры, пять KPI, два графика, таблица. */
export function NpsStatsSkeleton() {
  return (
    <div className="space-y-3">
      <ToolbarSkeleton search={false} controls={["w-48", "w-40"]} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-lg border bg-background p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-lg border bg-background p-5">
            <Skeleton className="mb-4 h-4 w-40" />
            <Skeleton className="h-[240px] w-full" />
          </div>
        ))}
      </div>
      <TableCardSkeleton
        pagination
        headers={[
          "Дата",
          "Клиент",
          { label: "Оценка", className: "w-[80px]" },
          "Категория",
          "Комментарий",
          "Опрос",
        ]}
      />
    </div>
  );
}

export function NpsPageSkeleton() {
  return (
    <ShellSkeleton title="NPS-опросы" actions={[{ label: "Добавить ответ" }]}>
      <div className="space-y-3">
        <TabsSkeleton labels={["Опросы", "Статистика"]} />
        <NpsSurveysSkeleton />
      </div>
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Мобильное приложение

export function NewsPageSkeleton() {
  return <ShowcaseSkeleton title="Новости" add="Добавить новость" />;
}

export function ServicesPageSkeleton() {
  return <ShowcaseSkeleton title="Услуги" add="Добавить услугу" />;
}

function ShowcaseSkeleton({ title, add }: { title: string; add: string }) {
  return (
    <TablePage
      title={title}
      actions={[{ label: add }]}
      toolbar={null}
      headers={[
        { label: "Порядок", className: "w-[90px]" },
        { label: "Картинка", className: "w-[100px]" },
        { label: "Баннер", className: "w-[140px]" },
        "Заголовок",
        { label: "Клубы", className: "w-[180px]" },
        "Описание",
        { label: "Кнопка", className: "w-[140px]" },
      ]}
    />
  );
}

export function PushPageSkeleton() {
  return (
    <TablePage
      title="Пуш-уведомления"
      actions={[{ label: "Добавить уведомление" }]}
      toolbar={null}
      headers={[
        "Заголовок",
        { label: "Клубы", className: "w-[180px]" },
        "Сегмент",
        "Отправка",
        "Статус",
        "Отправлено",
        "Доставлено",
        "Прочитано",
      ]}
    />
  );
}

export function PushTriggersPageSkeleton() {
  return (
    <ShellSkeleton title="Триггерные уведомления">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-background p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Zap className="h-6 w-6 text-muted-foreground" />
          </div>
          <Skeleton className="h-6 w-80 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
    </ShellSkeleton>
  );
}

/** Форма «Контактов и правил» (/club-settings): две секции, 3 и 1 поле. */
export function ClubSettingsFormSkeleton() {
  return (
    <div className="max-w-2xl space-y-8">
      {[3, 1].map((fields, i) => (
        <div key={i} className="space-y-4 rounded-lg border bg-background p-6">
          <div className="space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          {Array.from({ length: fields }).map((_, j) => (
            <div key={j} className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Выбор клуба над формой «Контактов и правил». */
export function ClubPickerSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-10 w-64 max-w-full" />
    </div>
  );
}

export function ClubSettingsPageSkeleton() {
  return (
    <ShellSkeleton title="Контакты и правила" actions={[{ label: "Сохранить" }]}>
      <div className="max-w-2xl space-y-6">
        <ClubPickerSkeleton />
        <ClubSettingsFormSkeleton />
      </div>
    </ShellSkeleton>
  );
}

/**
 * Форма «Настроек приложения»: по карточке на клиентское приложение
 * (иконка, подпись, предпросмотр). До загрузки клубов — две.
 */
export function AppSettingsFormSkeleton({ apps = 2 }: { apps?: number }) {
  return (
    <div className="max-w-2xl space-y-8">
      {Array.from({ length: apps }).map((_, i) => (
        <div key={i} className="space-y-4 rounded-lg border bg-background p-6">
          <div className="space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-16 w-16 rounded-[22%]" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-full max-w-80" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-36 w-44 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Форма «О нас»: справка и пять секций — обложка, две галереи студий,
 * сообщество (три числа и фото), Instagram (подписчики и сетка).
 */
export function AppAboutFormSkeleton() {
  const title = (
    <div className="space-y-2">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
  const label = <Skeleton className="h-4 w-1/4" />;
  return (
    <div className="max-w-2xl space-y-8">
      <Skeleton className="h-14 w-full rounded-md" />
      <div className="space-y-4 rounded-lg border bg-background p-6">
        {title}
        {label}
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-24" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4 rounded-lg border bg-background p-6">
          {title}
          {label}
          <div className="flex gap-3">
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} className="h-28 w-[90px]" />
            ))}
          </div>
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
      ))}
      <div className="space-y-4 rounded-lg border bg-background p-6">
        {title}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            {label}
            <Skeleton className="h-10 w-48" />
          </div>
        ))}
        {label}
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-24" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>
      <div className="space-y-4 rounded-lg border bg-background p-6">
        {title}
        {label}
        <Skeleton className="h-10 w-48" />
        {label}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-16 w-16" />
                <Skeleton className="h-9 w-24 rounded-full" />
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppAboutPageSkeleton() {
  return (
    <ShellSkeleton title="О нас" actions={[{ label: "Сохранить" }]}>
      <AppAboutFormSkeleton />
    </ShellSkeleton>
  );
}

export function AppSettingsPageSkeleton() {
  return (
    <ShellSkeleton title="Настройки приложения" actions={[{ label: "Сохранить" }]}>
      <AppSettingsFormSkeleton />
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Сотрудники

export function TrainersPageSkeleton() {
  return (
    <TablePage
      title="Сотрудники"
      actions={[{ label: "Добавить сотрудника" }]}
      toolbar={null}
      wrap={false}
      headers={[
        { label: "Фото", className: "w-[80px]" },
        "Имя",
        "Роль",
        "Клубы",
        "Telegram",
        "Банк",
        "Счёт",
        "Владелец счёта",
      ]}
    />
  );
}

export function PayRatesPageSkeleton() {
  return (
    <ShellSkeleton title="Зарплатные ставки">
      <div className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3">
          <Skeleton className="h-4 w-full max-w-3xl" />
        </div>
        <TableCardSkeleton
          pagination
          headers={[
            "Сотрудник",
            "Смена администратора",
            "Групповая тренировка",
            "Персональная тренировка",
          ]}
        />
      </div>
    </ShellSkeleton>
  );
}

/** Листание периода (PeriodStepper): ◀ «Текущий …» ▶ и подпись. */
function PeriodStepperSkeleton() {
  return (
    <div className="toolbar-full flex items-center gap-2">
      <IconButtonSkeleton>
        <ChevronLeft className="size-4" />
      </IconButtonSkeleton>
      <Skeleton className="h-10 w-36 rounded-full max-sm:flex-1" />
      <IconButtonSkeleton>
        <ChevronRight className="size-4" />
      </IconButtonSkeleton>
      <Skeleton className="ml-1 h-4 w-28 max-sm:hidden" />
    </div>
  );
}

export function AdminShiftsPageSkeleton() {
  return (
    <ShellSkeleton title="График администраторов">
      <div className="space-y-3">
        <div className="table-toolbar flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
          <PeriodStepperSkeleton />
        </div>
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-28 min-w-28 border-r border-b bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground sm:w-36 sm:min-w-36">
                  Клуб
                </th>
                {Array.from({ length: 30 }, (_, i) => (
                  <th
                    key={i}
                    className="w-[88px] min-w-[88px] space-y-1 border-r border-b px-1 py-1.5 last:border-r-0"
                  >
                    <Skeleton className="mx-auto h-3 w-5" />
                    <Skeleton className="mx-auto size-7 rounded-full" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 2 }, (_, r) => (
                <tr key={r}>
                  <th className="sticky left-0 z-10 border-r border-b bg-background px-3 py-2">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  {Array.from({ length: 30 }, (_, i) => (
                    <td key={i} className="border-r border-b p-1 align-top last:border-r-0">
                      <div className="flex min-h-14 flex-col gap-1">
                        <Skeleton className="h-6 w-full" />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Skeleton className="mx-1 h-3 w-full max-w-2xl" />
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-lg border bg-background">
            <div className="space-y-1.5 p-4 pb-0">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldSkeleton className="sm:col-span-2 xl:col-span-1" />
              <FieldSkeleton />
              <FieldSkeleton />
              <FieldSkeleton />
              <FieldSkeleton className="sm:col-span-2 xl:col-span-3" />
              <div className="flex items-end">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Дата", "Сотрудник", "Сумма", "Причина", "Добавил", ""].map((h, i) => (
                      <TableHead key={i} className={cn(i === 2 && "text-right", i === 5 && "w-10")}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableSkeletonRows columns={6} rows={3} />
                </TableBody>
              </Table>
            </div>
          </section>
          <section className="rounded-lg border bg-background p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1.5 h-3 w-48" />
            <ul className="mt-3 divide-y">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-7 w-8" />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </ShellSkeleton>
  );
}

export function PayrollPageSkeleton() {
  // Вкладки периода — с настоящими подписями и выбранной по умолчанию, как у
  // страницы. Дата — только на клиенте: на сервере и при гидратации — аванс.
  const today = useSyncExternalStore(noSubscribe, todayISO, () => null);
  const { month, period } = today
    ? defaultPeriod(today)
    : { month: "2026-01", period: "advance" as PeriodKey };
  const periods: PeriodKey[] = ["advance", "main", "month"];
  return (
    <ShellSkeleton title="Зарплаты">
      <div className="space-y-3">
        <div className="table-toolbar flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
          <PeriodStepperSkeleton />
          <TabsSkeleton
            labels={periods.map((p) => periodLabel(month, p))}
            active={periods.indexOf(period)}
            className="toolbar-full max-sm:w-full"
          />
          <div className="toolbar-full flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">
            <span className="flex items-center gap-1">
              Выплачено: <Skeleton className="h-4 w-16" />
            </span>
            <span className="flex items-center gap-1">
              Осталось: <Skeleton className="h-4 w-16" />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          <Skeleton className="h-3 w-full max-w-lg" />
        </div>
        <ToolbarSkeleton controls={["w-48", "w-48"]} />
        <TableCardSkeleton
          headers={[
            { label: "Сотрудник", className: "min-w-[220px]" },
            "Роль",
            { label: "Оклад", className: "text-right" },
            { label: "Продажи", className: "text-right" },
            { label: "Бонус 5%", className: "text-right" },
            { label: "Корректир.", className: "text-right" },
            { label: "Итого", className: "text-right" },
            "Статус",
          ]}
        />
      </div>
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Доступы, клубы, Kate

export function EmployeesPageSkeleton() {
  // Кнопка «Добавить сотрудника» и подвал появляются у страницы только с
  // данными — скелетон их не рисует, иначе они мигнут и пропадут.
  return (
    <TablePage
      title="Доступы"
      toolbar={null}
      pagination={false}
      rows={5}
      headers={["Имя", "Email", "Роль", "Клубы", "Разделы"]}
    />
  );
}

export function StudiosPageSkeleton() {
  return (
    <TablePage
      title="Клубы"
      toolbar={null}
      wrap={false}
      pagination={false}
      rows={2}
      headers={[
        "Название",
        { label: "Логотип", className: "w-[180px]" },
        "Тип",
        "Цвет",
        "Приложение клиентов",
      ]}
    />
  );
}

export function AssistantPageSkeleton() {
  return (
    <ShellSkeleton title="KATE — AI АССИСТЕНТ">
      <div className="mx-auto h-[calc(100dvh-8rem)] w-full max-w-3xl">
        <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-background">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="mt-4 grid w-full max-w-md gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
          <div className="flex gap-2 border-t p-3">
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 w-10" />
          </div>
        </div>
      </div>
    </ShellSkeleton>
  );
}

// ---------------------------------------------------------------------------
// Скрипты LS

/** Карточка скрипта: тёмная шапка, сообщения в «колодцах», подвал. */
export function ScriptCardSkeleton({ messages = 1 }: { messages?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 bg-sidebar px-4 py-3">
        <Skeleton className="h-5 w-56 max-w-[60%] bg-white/15" />
        <Skeleton className="h-5 w-14 rounded-full bg-white/10" />
        <Skeleton className="ml-auto h-8 w-8 bg-white/10 sm:w-48" />
      </div>
      <div className="space-y-4 px-4 py-3">
        {Array.from({ length: messages }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-32" />
            </div>
            <div className="space-y-2 rounded-md bg-canvas px-4 py-3">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t px-4 py-2">
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}

/**
 * Список скриптов, пока грузится дерево: в «Все скрипты» — по разделам
 * (заголовок + счётчик + карточки), в разделе — просто карточки.
 */
export function ScriptsListSkeleton({ grouped }: { grouped: boolean }) {
  if (!grouped)
    return (
      <div className="space-y-3">
        <ScriptCardSkeleton messages={2} />
        <ScriptCardSkeleton />
        <ScriptCardSkeleton />
      </div>
    );
  return (
    <>
      {[2, 1].map((cards, i) => (
        <section key={i} className="space-y-3">
          <div className="flex items-center gap-2 pt-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-5 w-7 rounded-full" />
          </div>
          {Array.from({ length: cards }, (_, j) => (
            <ScriptCardSkeleton key={j} messages={j === 0 ? 2 : 1} />
          ))}
        </section>
      ))}
    </>
  );
}

/** Закреплённая панель поиска и языков — как в scripts-page.tsx. */
function ScriptsToolbarSkeleton() {
  return (
    <div className="sticky -top-3 z-20 -mx-1 -mt-3 bg-canvas px-1 pt-3 pb-2 sm:-top-4 sm:-mt-4 sm:pt-4 lg:-top-6 lg:-mt-6 lg:pt-6">
      <div className="table-toolbar flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
        <Skeleton className="toolbar-search h-10 w-full max-w-96" />
        <TabsSkeleton labels={["RU", "EN", "GE"]} />
      </div>
    </div>
  );
}

function ScriptsPageSkeleton({ grouped }: { grouped: boolean }) {
  return (
    <ShellSkeleton title={grouped ? "Все скрипты" : "Скрипты LS"}>
      <div className="mx-auto max-w-4xl space-y-3">
        <ScriptsToolbarSkeleton />
        <Skeleton className="h-4 w-48" />
        <ScriptsListSkeleton grouped={grouped} />
      </div>
    </ShellSkeleton>
  );
}

export function ScriptsAllPageSkeleton() {
  return <ScriptsPageSkeleton grouped />;
}

export function ScriptsSectionPageSkeleton() {
  return <ScriptsPageSkeleton grouped={false} />;
}

/** Лента карточек «Хронологии» / «Предложений»: шапка, текст, поля. */
export function ScriptsFeedSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-background p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="ml-auto h-3 w-32" />
          </div>
          <Skeleton className="h-3.5 w-3/4" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Плитки статистики скриптов («Копирования», «Звонки»). */
export function ScriptsStatTilesSkeleton({ labels }: { labels: string[] }) {
  return (
    <div
      className={cn(
        "grid gap-3",
        labels.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4",
      )}
    >
      {labels.map((label) => (
        <StatTileSkeleton key={label} label={label} />
      ))}
    </div>
  );
}

/** «Звонки» → «Сводка»: три плитки, воронка этапов, где заканчивают. */
export function CallStatsSummarySkeleton() {
  return (
    <div className="space-y-3">
      <ScriptsStatTilesSkeleton labels={CALL_TILES} />
      {[
        { title: "w-40", headers: ["#", "Этап", "Доля дошедших", "Дошли", "Закончились здесь"] },
        { title: "w-48", headers: ["Блок", "Доля", "Звонков", "%"] },
      ].map((t, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className={cn("h-6", t.title)} />
          <TableCardSkeleton headers={t.headers} rows={4} />
        </div>
      ))}
    </div>
  );
}

/** «Подстановка»: три блока настроек с сеткой полей. */
export function ScriptsSubstitutionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-full max-w-xl" />
      {[2, 3, 2].map((rows, i) => (
        <div key={i} className="space-y-4 rounded-lg border bg-background p-4 sm:p-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          {Array.from({ length: rows }, (_, j) => (
            <div
              key={j}
              className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(10rem,14rem)_repeat(3,minmax(0,1fr))_2rem] md:items-center"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <span />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Вкладки «Настроек скриптов» — подписи статичные, как в settings.tsx. */
const SCRIPTS_SETTINGS_TABS = [
  { key: "history", label: "Хронология" },
  { key: "suggestions", label: "Предложения" },
  { key: "stats", label: "Статистика" },
  { key: "calls", label: "Звонки" },
  { key: "vars", label: "Подстановка" },
];

const PERIOD_TABS = ["Сегодня", "7 дней", "30 дней", "Всё время"];

/** Фильтр периода статистики: вкладки + две даты. */
function PeriodFilterSkeleton() {
  return (
    <>
      {/* По умолчанию у статистики — «30 дней». */}
      <TabsSkeleton labels={PERIOD_TABS} active={2} className="toolbar-full" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-10 w-40" />
    </>
  );
}

/** «Статистика» (копирования): фильтры, четыре плитки, таблица скриптов. */
export function CopyStatsSkeleton() {
  return (
    <div className="space-y-3">
      <ToolbarSkeleton search={false}>
        <PeriodFilterSkeleton />
        <Skeleton className="h-10 w-48" />
        <TabsSkeleton labels={["Все языки", "RU", "EN", "GE"]} className="toolbar-full" />
      </ToolbarSkeleton>
      <ScriptsStatTilesSkeleton
        labels={["Копирований", "RU · русский", "EN · английский", "GE · грузинский"]}
      />
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Скрипты</h2>
        <TableCardSkeleton
          rows={5}
          headers={[
            { label: "#", className: "w-12" },
            "Скрипт",
            { label: "Доля", className: "w-40" },
            "Всего",
            "RU",
            "EN",
            "GE",
          ]}
        />
      </div>
    </div>
  );
}

const CALL_TILES = ["Звонков за период", "Дошли до конца сценария", "Шагов сценария в среднем"];

/** «Звонки»: фильтр периода, «Сводка / Звонки» и сводка. */
export function CallStatsSkeleton() {
  return (
    <div className="space-y-3">
      <ToolbarSkeleton search={false}>
        <PeriodFilterSkeleton />
      </ToolbarSkeleton>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TabsSkeleton labels={["Сводка", "Звонки"]} />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <CallStatsSummarySkeleton />
    </div>
  );
}

/** Тело «Настроек скриптов» для вкладки `tab` (из адреса, ?tab=). */
export function ScriptsSettingsBodySkeleton({ tab = "history" }: { tab?: string }) {
  const known = SCRIPTS_SETTINGS_TABS.some((t) => t.key === tab) ? tab : "history";
  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto">
        <div className="relative inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          {SCRIPTS_SETTINGS_TABS.map((t) => (
            <span
              key={t.key}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium",
                t.key === known && "bg-primary text-primary-foreground",
              )}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {known === "stats" ? (
        <CopyStatsSkeleton />
      ) : known === "calls" ? (
        <CallStatsSkeleton />
      ) : known === "vars" ? (
        <ScriptsSubstitutionSkeleton />
      ) : (
        <ScriptsFeedSkeleton />
      )}
    </div>
  );
}

export function ScriptsSettingsPageSkeleton() {
  const tab = useRouterState({
    select: (s) => (s.location.search as { tab?: string }).tab,
  });
  return (
    <ShellSkeleton title="Настройки скриптов">
      <ScriptsSettingsBodySkeleton tab={tab} />
    </ShellSkeleton>
  );
}
