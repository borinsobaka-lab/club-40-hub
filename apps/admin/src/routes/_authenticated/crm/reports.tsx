import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { StageDot } from "@/components/crm/parts";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { CrmReportsPageSkeleton } from "@/components/page-skeletons";
import { TableToolbar } from "@/components/table-toolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoNote } from "@/components/ui/form-field";
import { StatTile } from "@/components/ui/stat-tile";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { hasRight } from "@/lib/admin-access";
import {
  crmPeopleQuery,
  crmScenariosQuery,
  crmSetupQuery,
  useCrmReport,
  useFunnelReport,
  usePeopleReport,
  useScenariosReport,
} from "@/lib/crm/data";
import {
  FUNNEL_GROUPS,
  funnelMoney,
  funnelSteps,
  percent,
  scenarioLabel,
  waitLabel,
  type FunnelGroup,
} from "@/lib/crm/logic";
import { formatMoney, todayISO } from "@/lib/format";

const REPORT_TABS = [
  { value: "funnel", label: "Воронка" },
  { value: "people", label: "Сотрудники" },
  { value: "sources", label: "Источники и деньги" },
  { value: "scenarios", label: "Клиенты клуба" },
] as const;
type ReportTab = (typeof REPORT_TABS)[number]["value"];

const ALL = "all";

const GROUP_COLUMN = {
  source: "Источник",
  campaign: "Кампания",
  studio: "Клуб",
  responsible: "Ответственный",
} as const;

export const Route = createFileRoute("/_authenticated/crm/reports")({
  head: () => ({ meta: [{ title: "Отчёт — CRM — Base40 Admin" }] }),
  pendingComponent: CrmReportsPageSkeleton,
  validateSearch: (s: Record<string, unknown>): { tab?: ReportTab } => ({
    tab: REPORT_TABS.some((t) => t.value === s.tab) ? (s.tab as ReportTab) : undefined,
  }),
  component: CrmReportsPage,
});

const TIPS = {
  conversion:
    "Доля успешных среди сделок, закрытых за период: успешные / (успешные + не реализованные).",
  reply:
    "Сколько клиент ждал первого ответа сотрудника — медиана по диалогам, начатым за период. Автоматические сообщения ответом не считаются.",
  replyAll:
    "Сколько клиент ждал ответа — медиана по всем обращениям за период (каждое сообщение клиента после нашего ответа). Считается рабочее время; автоматические сообщения ответом не считаются.",
  inSla: "Доля обращений, на которые ответили в норматив.",
  noReply: "Обращения за период, на которые сотрудник так и не ответил.",
  ltv: "Все покупки клиентов, пришедших с этих заявок, — с момента заявки по сегодня (первая покупка и продления).",
  cac: "Расход на рекламу, делённый на число купивших.",
  romi: "Окупаемость рекламы: (выручка с клиентов − расход) / расход.",
};

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function monthStartISO() {
  return `${todayISO().slice(0, 8)}01`;
}

/**
 * «Отчёт» — вкладки: «Воронка» (этапы, закрытые за период, причины отказа),
 * «Сотрудники» (сделки, скорость ответа, задачи), «Источники и деньги»
 * (сквозная воронка заявок с выручкой и расходом на рекламу), «Клиенты
 * клуба» (сценарии: продление, возврат, долги). Считается то, что видит
 * сотрудник (свои клубы и сделки без клуба).
 */
function CrmReportsPage() {
  const navigate = Route.useNavigate();
  const tab = Route.useSearch().tab ?? "funnel";
  const { data: setup } = useQuery(crmSetupQuery);
  const pipelines = setup?.pipelines ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | undefined>(() => ({
    from: new Date(`${monthStartISO()}T00:00:00`),
    to: new Date(`${todayISO()}T00:00:00`),
  }));
  // Период не выбран (сбросили) — текущий месяц.
  const from = range?.from ? localISO(range.from) : monthStartISO();
  const to = range?.to ? localISO(range.to) : range?.from ? localISO(range.from) : todayISO();
  const firstPipeline = pipelines.find((p) => !p.is_archived)?.id ?? null;
  // «Воронка» считается по одной воронке, остальные вкладки — по одной или по всем.
  const onePipeline = picked && picked !== ALL ? picked : firstPipeline;
  const anyPipeline = picked === null || picked === ALL ? null : picked;

  return (
    <AdminShell title="Отчёт">
      <div className="mx-auto max-w-6xl space-y-4">
        <TableToolbar>
          <SegmentedControl
            aria-label="Раздел отчёта"
            value={tab}
            onChange={(v) => void navigate({ search: { tab: v }, replace: true })}
            options={REPORT_TABS.map((t) => ({ value: t.value, label: t.label }))}
          />
          {tab !== "scenarios" && firstPipeline && (
            <Select
              value={tab === "funnel" ? (onePipeline ?? "") : (anyPipeline ?? ALL)}
              onValueChange={setPicked}
            >
              <SelectTrigger aria-label="Воронка" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tab !== "funnel" && <SelectItem value={ALL}>Все воронки</SelectItem>}
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DateRangeFilter
            value={range}
            onChange={setRange}
            placeholder="Текущий месяц"
            title="Период отчёта"
            showLabel={false}
          />
        </TableToolbar>

        {tab === "funnel" && <FunnelTab pipelineId={onePipeline} from={from} to={to} />}
        {tab === "people" && <PeopleTab pipelineId={anyPipeline} from={from} to={to} />}
        {tab === "sources" && <SourcesTab pipelineId={anyPipeline} from={from} to={to} />}
        {tab === "scenarios" && <ScenariosTab from={from} to={to} />}
      </div>
    </AdminShell>
  );
}

type TabProps = { pipelineId: string | null; from: string; to: string };

function usePersonName() {
  const { data: people = [] } = useQuery(crmPeopleQuery);
  return (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.full_name ?? "Сотрудник") : "Без ответственного";
}

function FunnelTab({ pipelineId, from, to }: TabProps) {
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: report, isLoading } = useCrmReport(pipelineId, from, to);
  const personName = usePersonName();
  const stages = (setup?.stages ?? []).filter(
    (s) => s.pipeline_id === pipelineId && s.kind === "open",
  );
  const loading = isLoading || !report;

  const closed = (report?.won.count ?? 0) + (report?.lost.count ?? 0);
  const conversion = report ? percent(report.won.count, closed) : null;
  const inStage = new Map(report?.stages.map((s) => [s.stage_id, s]));
  const maxInStage = Math.max(1, ...(report?.stages.map((s) => s.count) ?? []));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Создано сделок" value={report?.created} loading={loading} />
        <StatTile label="Успешно" value={report?.won.count} loading={loading} />
        <StatTile
          label="Сумма успешных"
          value={report ? formatMoney(report.won.budget) : undefined}
          loading={loading}
        />
        <StatTile label="Не реализовано" value={report?.lost.count} loading={loading} />
        <StatTile
          label={<span title={TIPS.conversion}>Конверсия закрытых</span>}
          value={conversion === null ? "—" : `${conversion}%`}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.reply}>Первый ответ</span>}
          value={waitLabel(report?.reply.median_minutes ?? null)}
          loading={loading}
        />
      </div>
      {report && report.unanswered > 0 && <WaitingNote count={report.unanswered} />}

      <Section title="Сейчас в этапах">
        {stages.map((s) => {
          const row = inStage.get(s.id);
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex w-32 shrink-0 items-center gap-2 truncate text-sm sm:w-52">
                <StageDot color={s.color} />
                {s.name}
              </span>
              <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${((row?.count ?? 0) / maxInStage) * 100}%`,
                    backgroundColor: s.color,
                  }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                {row?.count ?? 0}
                {row && row.budget > 0 ? ` · ${formatMoney(row.budget)}` : ""}
              </span>
            </div>
          );
        })}
        {stages.length === 0 && <Empty>В воронке нет этапов.</Empty>}
      </Section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Сотрудники">
          <Rows
            head={["Ответственный", "В работе", "Успешно", "Отказ"]}
            rows={(report?.people ?? []).map((p) => [
              personName(p.user_id),
              p.open,
              p.won ? `${p.won} · ${formatMoney(p.won_budget)}` : 0,
              p.lost,
            ])}
          />
        </Section>
        <div className="space-y-4">
          <Section title="Причины отказа">
            <Rows
              head={["Причина", "Сделок"]}
              rows={(report?.loss ?? []).map((l) => [l.name, l.count])}
            />
          </Section>
          <Section title="Источники новых сделок">
            <Rows
              head={["Источник", "Создано", "Из них успешно"]}
              rows={(report?.sources ?? []).map((s) => [s.source, s.created, s.won])}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

function WaitingNote({ count }: { count: number }) {
  return (
    <InfoNote variant="warning">
      Клиент ждёт ответа в {count} {count === 1 ? "диалоге" : "диалогах"}.{" "}
      <Link to="/crm/inbox" className="font-medium underline underline-offset-2">
        Открыть «Диалоги»
      </Link>
    </InfoNote>
  );
}

const share = (part: number, total: number) => {
  const p = percent(part, total);
  return p === null ? "—" : `${p}%`;
};

/** «Сотрудники»: кто сколько продал, как быстро отвечает и как ведёт задачи. */
function PeopleTab({ pipelineId, from, to }: TabProps) {
  const { data: report, isLoading } = usePeopleReport(pipelineId, from, to);
  const personName = usePersonName();
  const loading = isLoading || !report;
  const noReply = report ? report.asked - report.answered : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label={<span title={TIPS.replyAll}>Время ответа</span>}
          value={waitLabel(report?.reply_median ?? null)}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.inSla}>Ответили за {report?.sla_minutes ?? 15} мин</span>}
          value={report ? share(report.reply_in_sla, report.answered) : undefined}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.noReply}>Остались без ответа</span>}
          value={noReply}
          tone={noReply > 0 ? "warning" : "default"}
          loading={loading}
        />
        <StatTile
          label="Ждут ответа сейчас"
          value={report?.unanswered}
          tone={report && report.unanswered > 0 ? "negative" : "default"}
          loading={loading}
        />
      </div>
      {report && report.unanswered > 0 && <WaitingNote count={report.unanswered} />}

      <Section title="Продажи">
        <Rows
          head={["Сотрудник", "В работе", "Получил", "Успешно", "Сумма", "Отказ", "Конверсия"]}
          rows={(report?.people ?? [])
            .filter((p) => p.open + p.created + p.won + p.lost > 0)
            .map((p) => [
              personName(p.user_id),
              p.open,
              p.created,
              p.won,
              p.won ? formatMoney(p.won_budget) : "—",
              p.lost,
              share(p.won, p.won + p.lost),
            ])}
        />
      </Section>
      <Section title="Ответы клиентам и задачи">
        <Rows
          head={[
            "Сотрудник",
            "Ответов",
            "Время ответа",
            "В норматив",
            "Сообщений",
            "Задач выполнено",
            "С опозданием",
            "Просрочено сейчас",
          ]}
          rows={(report?.people ?? [])
            .filter((p) => p.user_id && p.replies + p.messages + p.tasks_done + p.tasks_overdue > 0)
            .map((p) => [
              personName(p.user_id),
              p.replies,
              waitLabel(p.reply_median),
              share(p.reply_in_sla, p.replies),
              p.messages,
              p.tasks_done,
              p.tasks_late,
              p.tasks_overdue,
            ])}
        />
      </Section>
      <p className="px-1 text-xs text-muted-foreground">
        «Получил» — сделки, заведённые за период; «Успешно» и «Отказ» — закрытые за период. Ответ
        засчитывается тому, кто ответил; время — рабочее. Задача «с опозданием» — выполнена позже
        срока больше чем на час.
      </p>
    </>
  );
}

/** «Источники и деньги»: путь заявки до покупки, выручка и расход на рекламу. */
function SourcesTab({ pipelineId, from, to }: TabProps) {
  const [group, setGroup] = useState<FunnelGroup>("source");
  const { data: report, isLoading } = useFunnelReport(group, pipelineId, from, to);
  const access = useAdminAccess();
  const canManage = hasRight(access, "crm.manage");
  const loading = isLoading || !report;
  const total = report?.total;
  const money = total ? funnelMoney(total) : null;
  const steps = total ? funnelSteps(total) : [];
  const groupLabel = FUNNEL_GROUPS.find((g) => g.value === group)!.label;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Заявок" value={total?.leads} loading={loading} />
        <StatTile
          label="Купили"
          value={total ? `${total.won} · ${share(total.won, total.leads)}` : undefined}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.ltv}>Выручка с клиентов</span>}
          value={total ? formatMoney(total.ltv) : undefined}
          loading={loading}
        />
        <StatTile
          label="Расход на рекламу"
          value={total ? formatMoney(total.spend) : undefined}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.cac}>Цена клиента</span>}
          value={money?.cac == null ? "—" : formatMoney(money.cac)}
          loading={loading}
        />
        <StatTile
          label={<span title={TIPS.romi}>Окупаемость</span>}
          value={money?.romi == null ? "—" : `${money.romi}%`}
          tone={money?.romi != null && money.romi < 0 ? "negative" : "default"}
          loading={loading}
        />
      </div>

      <Section title="Путь заявки">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-3 px-4 py-2">
            <span className="w-24 shrink-0 text-sm">{step.label}</span>
            <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-brand"
                style={{ width: `${total && total.leads ? (step.count / total.leads) * 100 : 0}%` }}
              />
            </div>
            <span className="w-36 shrink-0 text-right text-sm tabular-nums">
              {step.count}
              {i > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {share(step.count, steps[i - 1].count)} от шага
                </span>
              )}
            </span>
          </div>
        ))}
        {!loading && total?.leads === 0 && <Empty>За период заявок нет.</Empty>}
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Разрез отчёта"
          value={group}
          onChange={setGroup}
          options={FUNNEL_GROUPS}
        />
        {canManage && (
          <Link
            to="/crm/settings"
            search={{ tab: "sources" }}
            className="text-sm font-medium text-link underline underline-offset-2"
          >
            Формы, ссылки и расходы на рекламу
          </Link>
        )}
      </div>
      <Section title={groupLabel}>
        <Rows
          head={[
            GROUP_COLUMN[group],
            "Заявки",
            "Ответили",
            "Записаны",
            "Пришли",
            "Купили",
            "Конверсия",
            "Первая покупка",
            "Выручка с клиентов",
            ...(group === "responsible"
              ? []
              : ["Расход", "Цена заявки", "Цена клиента", "Окупаемость"]),
          ]}
          rows={(report?.rows ?? []).map((r) => {
            const m = funnelMoney(r);
            return [
              r.label ?? "—",
              r.leads,
              r.replied,
              r.booked,
              r.attended,
              r.won,
              share(r.won, r.leads),
              r.revenue ? formatMoney(r.revenue) : "—",
              r.ltv ? formatMoney(r.ltv) : "—",
              ...(group === "responsible"
                ? []
                : [
                    r.spend ? formatMoney(r.spend) : "—",
                    m.cpl === null ? "—" : formatMoney(m.cpl),
                    m.cac === null ? "—" : formatMoney(m.cac),
                    m.romi === null ? "—" : `${m.romi}%`,
                  ]),
            ];
          })}
        />
      </Section>
      <p className="px-1 text-xs text-muted-foreground">
        Считаются заявки, заведённые за период (без сценариев по клиентам клуба), и то, что с ними
        стало к сегодняшнему дню. «Записаны» и «Пришли» — у контакта, привязанного к карточке
        клиента. Расход за месяц берётся по дням, попавшим в период.
      </p>
    </>
  );
}

/** «Клиенты клуба»: что дали сценарии — продление, возврат, долги. */
function ScenariosTab({ from, to }: { from: string; to: string }) {
  const { data: rows, isLoading } = useScenariosReport(from, to);
  const { data: scenarios = [] } = useQuery(crmScenariosQuery);
  const access = useAdminAccess();
  const loading = isLoading || !rows;
  const sum = (key: "created" | "open" | "won" | "lost" | "won_budget") =>
    (rows ?? []).reduce((acc, r) => acc + Number(r[key]), 0);
  const anyEnabled = scenarios.some((s) => s.enabled);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Заведено сделок" value={sum("created")} loading={loading} />
        <StatTile
          label="Успешно"
          value={`${sum("won")} · ${share(sum("won"), sum("won") + sum("lost"))}`}
          loading={loading}
        />
        <StatTile label="Сумма успешных" value={formatMoney(sum("won_budget"))} loading={loading} />
        <StatTile label="В работе" value={sum("open")} loading={loading} />
      </div>
      {!anyEnabled && scenarios.length > 0 && (
        <InfoNote variant="info">
          Сценарии выключены: сделки по продлениям, возврату и долгам сами не заводятся.{" "}
          {hasRight(access, "crm.manage") ? (
            <Link
              to="/crm/settings"
              search={{ tab: "scenarios" }}
              className="font-medium underline underline-offset-2"
            >
              Включить в настройках
            </Link>
          ) : (
            "Включает сотрудник с правом «CRM: настройка»."
          )}
        </InfoNote>
      )}
      <Section title="Сценарии">
        <Rows
          head={["Сценарий", "Заведено", "В работе", "Успешно", "Отказ", "Конверсия", "Сумма"]}
          rows={(rows ?? []).map((r) => [
            scenarioLabel(r.key),
            r.created,
            r.open,
            r.won,
            r.lost,
            share(r.won, r.won + r.lost),
            r.won_budget ? formatMoney(r.won_budget) : "—",
          ])}
        />
      </Section>
      <p className="px-1 text-xs text-muted-foreground">
        Сделки сценариев, заведённые за период, и чем они закончились. Сумма — покупка, закрывшая
        сделку (у долга — внесённый платёж).
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-background">
      <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">{title}</h2>
      <div className="py-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-4 text-center text-sm text-muted-foreground">{children}</p>;
}

function Rows({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <Empty>За период данных нет.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th
                key={h}
                className={
                  i === 0
                    ? "px-4 py-1.5 text-left font-medium"
                    : "px-4 py-1.5 text-right font-medium"
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={j === 0 ? "px-4 py-1.5" : "px-4 py-1.5 text-right tabular-nums"}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
