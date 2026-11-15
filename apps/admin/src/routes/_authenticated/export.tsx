import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ExportPageSkeleton } from "@/components/page-skeletons";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useStudios } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/format";
import {
  clientLines,
  excelDate,
  membershipLines,
  type ClientLine,
  type ExportMembershipRow,
  type MembershipLine,
} from "@/lib/export-memberships";

/**
 * «Управление» → «Экспорт» (решение владельца 2026-11-15): выгрузка
 * абонементов клиентов в Excel — свести с выгрузкой прежней учётной системы
 * и найти тех, у кого абонемент там закончился, а здесь нового нет. Два
 * листа: «Абонементы» (строка на абонемент) и «Клиенты» (строка на клиента:
 * есть ли действующий). Только владельцу клуба — в файле личные данные;
 * строки — абонементы его клубов (client_memberships.studio_id, у пакетных —
 * клуб продажи), RLS действует. Разбор строк — lib/export-memberships.ts.
 */
export const Route = createFileRoute("/_authenticated/export")({
  head: () => ({ meta: [{ title: "Экспорт — Base40 Admin" }] }),
  pendingComponent: ExportPageSkeleton,
  component: ExportPage,
});

type Mode = "current" | "all";
const MODES = [
  { value: "current" as const, label: "Только действующие" },
  { value: "all" as const, label: "Все абонементы" },
];

const COLUMNS =
  "id, studio_id, status, started_at, ends_at, visits_left, personal_left, diagnostics_left, starts_on_first_visit, created_at, clients(id, full_name, first_name, last_name, email, phone, phone2), memberships(name, kind)";
const PAGE = 1000;

/** Все абонементы клубов — постранично (PostgREST отдаёт не больше 1000 строк). */
async function loadMemberships(studioIds: string[]): Promise<ExportMembershipRow[]> {
  const out: ExportMembershipRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("client_memberships")
      .select(COLUMNS)
      .in("studio_id", studioIds)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ExportMembershipRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const DATE = "dd.mm.yyyy";
const bold = (value: string) => ({ value, fontWeight: "bold" as const });
const str = (value: string) => ({ value, type: String });
const num = (value: number | null) => ({ value: value ?? undefined, type: Number });
const date = (iso: string | null) => ({
  value: excelDate(iso) ?? undefined,
  type: Date,
  format: DATE,
});
const yes = (v: boolean) => str(v ? "да" : "нет");

const MEMBERSHIP_COLUMNS = [
  { header: bold("Клиент"), cell: (l: MembershipLine) => str(l.client), width: 28 },
  { header: bold("Почта"), cell: (l: MembershipLine) => str(l.email), width: 28 },
  { header: bold("Телефон"), cell: (l: MembershipLine) => str(l.phone), width: 16 },
  { header: bold("Телефон 2"), cell: (l: MembershipLine) => str(l.phone2), width: 16 },
  { header: bold("Клуб"), cell: (l: MembershipLine) => str(l.club), width: 16 },
  { header: bold("Абонемент"), cell: (l: MembershipLine) => str(l.membership), width: 28 },
  { header: bold("Тип"), cell: (l: MembershipLine) => str(l.kind), width: 22 },
  { header: bold("Статус"), cell: (l: MembershipLine) => str(l.status), width: 18 },
  { header: bold("Действует"), cell: (l: MembershipLine) => yes(l.current), width: 10 },
  { header: bold("Начало"), cell: (l: MembershipLine) => date(l.startedAt), width: 12 },
  { header: bold("Окончание"), cell: (l: MembershipLine) => date(l.endsAt), width: 12 },
  { header: bold("Осталось групповых"), cell: (l: MembershipLine) => num(l.visitsLeft), width: 12 },
  {
    header: bold("Осталось персональных"),
    cell: (l: MembershipLine) => num(l.personalLeft),
    width: 12,
  },
  {
    header: bold("Осталось диагностик"),
    cell: (l: MembershipLine) => num(l.diagnosticsLeft),
    width: 12,
  },
  { header: bold("Оформлен"), cell: (l: MembershipLine) => date(l.createdAt), width: 12 },
];

const CLIENT_COLUMNS = [
  { header: bold("Клиент"), cell: (l: ClientLine) => str(l.client), width: 28 },
  { header: bold("Почта"), cell: (l: ClientLine) => str(l.email), width: 28 },
  { header: bold("Телефон"), cell: (l: ClientLine) => str(l.phone), width: 16 },
  { header: bold("Телефон 2"), cell: (l: ClientLine) => str(l.phone2), width: 16 },
  { header: bold("Клубы"), cell: (l: ClientLine) => str(l.clubs), width: 20 },
  { header: bold("Есть действующий"), cell: (l: ClientLine) => yes(l.hasCurrent), width: 12 },
  { header: bold("Действующий абонемент"), cell: (l: ClientLine) => str(l.current), width: 28 },
  { header: bold("Действует до"), cell: (l: ClientLine) => date(l.currentEndsAt), width: 12 },
  { header: bold("Последний закончившийся"), cell: (l: ClientLine) => str(l.lastEnded), width: 28 },
  { header: bold("Закончился"), cell: (l: ClientLine) => date(l.lastEndedAt), width: 12 },
  { header: bold("Абонементов всего"), cell: (l: ClientLine) => num(l.total), width: 10 },
];

function ExportPage() {
  const access = useAdminAccess();
  const { data: studios } = useStudios();
  const clubs = (studios ?? []).filter((s) => access?.studios[s.id]?.owner);
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? clubs.map((c) => c.id);
  const [mode, setMode] = useState<Mode>("current");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string, on: boolean) =>
    setPicked(on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id));

  const download = async () => {
    if (selected.length === 0) {
      toast.error("Выберите хотя бы один клуб");
      return;
    }
    setBusy(true);
    try {
      const today = todayISO();
      const names = new Map(clubs.map((c) => [c.id, c.name]));
      const clubName = (id: string) => names.get(id) ?? "";
      const rows = await loadMemberships(selected);
      const all = membershipLines(rows, clubName, today);
      const lines = mode === "current" ? all.filter((l) => l.current) : all;
      const clients = clientLines(rows, clubName, today);
      // Писатель Excel — только на этой странице, по нажатию.
      const { default: writeXlsxFile, getSheetData } = await import("write-excel-file/browser");
      await writeXlsxFile([
        {
          data: getSheetData(lines, MEMBERSHIP_COLUMNS),
          columns: MEMBERSHIP_COLUMNS,
          sheet: "Абонементы",
          stickyRowsCount: 1,
        },
        {
          data: getSheetData(clients, CLIENT_COLUMNS),
          columns: CLIENT_COLUMNS,
          sheet: "Клиенты",
          stickyRowsCount: 1,
        },
      ]).toFile(`abonementy-${today}.xlsx`);
      toast.success(`Выгружено: абонементов — ${lines.length}, клиентов — ${clients.length}`);
    } catch (e) {
      toast.error("Не удалось выгрузить: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Экспорт">
      <div className="max-w-4xl space-y-8">
        <section className="space-y-4 rounded-lg border bg-background p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Абонементы клиентов</h2>
            <p className="text-sm text-muted-foreground">
              Файл Excel для сверки с прежней учётной системой. Лист «Абонементы» — строка на каждый
              абонемент: клиент, почта, телефон, клуб, статус, срок и остаток. Лист «Клиенты» —
              строка на клиента: есть ли у него сейчас действующий абонемент и когда закончился
              последний.
            </p>
          </div>

          <FormField label="Клубы" required>
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {clubs.map((c) => (
                <CheckboxOption
                  key={c.id}
                  checked={selected.includes(c.id)}
                  onCheckedChange={(on) => toggle(c.id, on)}
                >
                  {c.name}
                </CheckboxOption>
              ))}
            </div>
          </FormField>

          <FormField
            label="Абонементы"
            tip="«Только действующие» — действует, заморожен, ждёт первого посещения или начала после текущего. Лист «Клиенты» строится по всем абонементам."
          >
            <SegmentedControl
              aria-label="Какие абонементы"
              value={mode}
              onChange={setMode}
              options={MODES}
            />
          </FormField>

          <InfoNote>
            Почта — в нижнем регистре, телефон — в международном виде (+995…): по ним удобно сводить
            таблицы. В файле личные данные клиентов — не пересылайте его без надобности.
          </InfoNote>

          <Button onClick={download} disabled={busy || clubs.length === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <FileDown />} Скачать Excel
          </Button>
        </section>
      </div>
    </AdminShell>
  );
}
