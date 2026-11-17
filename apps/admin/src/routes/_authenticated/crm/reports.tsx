import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { StageDot } from "@/components/crm/parts";
import { CrmReportsPageSkeleton } from "@/components/page-skeletons";
import { TableToolbar } from "@/components/table-toolbar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
import { crmPeopleQuery, crmSetupQuery, useCrmReport } from "@/lib/crm/data";
import { percent, waitLabel } from "@/lib/crm/logic";
import { formatMoney, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/reports")({
  head: () => ({ meta: [{ title: "Отчёт — CRM — Base40 Admin" }] }),
  pendingComponent: CrmReportsPageSkeleton,
  component: CrmReportsPage,
});

const TIPS = {
  conversion:
    "Доля успешных среди сделок, закрытых за период: успешные / (успешные + не реализованные).",
  reply:
    "Сколько клиент ждал первого ответа сотрудника — медиана по диалогам, начатым за период. Автоматические сообщения ответом не считаются.",
};

function monthStartISO() {
  return `${todayISO().slice(0, 8)}01`;
}

/**
 * «Отчёт» — воронка за период: что сейчас в этапах, сколько создано и
 * закрыто, причины отказа, сотрудники, источники, скорость первого ответа.
 * Считаются сделки, которые видит сотрудник (свои клубы и без клуба).
 */
function CrmReportsPage() {
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const pipelines = setup?.pipelines ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [from, setFrom] = useState(monthStartISO);
  const [to, setTo] = useState(todayISO);
  const pipelineId = picked ?? pipelines.find((p) => !p.is_archived)?.id ?? null;
  const { data: report, isLoading } = useCrmReport(pipelineId, from, to);
  const stages = (setup?.stages ?? []).filter(
    (s) => s.pipeline_id === pipelineId && s.kind === "open",
  );
  const loading = isLoading || !report;

  const closed = (report?.won.count ?? 0) + (report?.lost.count ?? 0);
  const conversion = report ? percent(report.won.count, closed) : null;
  const inStage = new Map(report?.stages.map((s) => [s.stage_id, s]));
  const maxInStage = Math.max(1, ...(report?.stages.map((s) => s.count) ?? []));
  const personName = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.full_name ?? "Сотрудник") : "Без ответственного";

  return (
    <AdminShell title="Отчёт">
      <div className="mx-auto max-w-5xl space-y-4">
        <TableToolbar>
          {pipelineId && (
            <Select value={pipelineId} onValueChange={setPicked}>
              <SelectTrigger aria-label="Воронка" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-sm text-muted-foreground">с</span>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Период с"
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">по</span>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Период по"
            className="w-40"
          />
        </TableToolbar>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Создано сделок" value={report?.created} loading={loading} />
          <StatTile
            label="Успешно"
            value={report ? `${report.won.count} · ${formatMoney(report.won.budget)}` : undefined}
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
            tone={report && report.unanswered > 0 ? "warning" : "default"}
            loading={loading}
          />
        </div>
        {report && report.unanswered > 0 && (
          <p className="text-sm text-amber-700">
            Диалогов, где клиент ждёт ответа: {report.unanswered}.
          </p>
        )}

        <Section title="Сейчас в этапах">
          {stages.map((s) => {
            const row = inStage.get(s.id);
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2">
                <span className="flex w-52 shrink-0 items-center gap-2 truncate text-sm">
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
      </div>
    </AdminShell>
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
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th
              key={h}
              className={
                i === 0 ? "px-4 py-1.5 text-left font-medium" : "px-4 py-1.5 text-right font-medium"
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
  );
}
