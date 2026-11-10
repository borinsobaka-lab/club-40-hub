import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ImportCarryoverPageSkeleton } from "@/components/page-skeletons";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useStudios } from "@/hooks/use-studios";
import { useCatalogStudioIds } from "@/hooks/use-catalog-studios";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/contacts";
import type { Cell } from "@/lib/analytics/import";
import {
  addCarryoverResult,
  carryoverChunks,
  emptyCarryoverResult,
  parseCarryoverSheet,
  summarizeCarryover,
  type CarryoverParse,
  type CarryoverResult,
} from "@/lib/import-carryover";

/**
 * «Импорт переноса» (решение владельца 2026-11-10): клиенты купленной
 * студии с абонементом переноса. Владелец клуба выбирает выгрузку прежней
 * студии (xlsx как есть), клуб и абонемент переноса из «Номенклатур»;
 * страница разбирает файл (lib/import-carryover.ts), показывает, что
 * перенесётся, и отдаёт строки базе пачками (RPC carryover_import_chunk).
 * Повторный запуск ничего не задваивает. Схема —
 * db/migrations/2026-11-10_zz_carryover_import.sql.
 */
export const Route = createFileRoute("/_authenticated/import-carryover")({
  head: () => ({ meta: [{ title: "Импорт переноса — Base40 Admin" }] }),
  pendingComponent: ImportCarryoverPageSkeleton,
  component: ImportCarryoverPage,
});

/** Срок долга по умолчанию — решение владельца 2026-11-10. */
const DEFAULT_DEBT_DUE = "2026-11-29";
const nf = new Intl.NumberFormat("ru-RU");

type Run = {
  done: number;
  total: number;
  result: CarryoverResult;
  error: string | null;
  next: number;
  running: boolean;
};

type Status = { clients: number; sales: number; signedIn: number };

function countOf({ count, error }: { count: number | null; error: { message: string } | null }) {
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function fetchStatus(studioId: string): Promise<Status> {
  const head = { count: "exact", head: true } as const;
  const prefix = `${studioId}:%`;
  const [clients, signedIn, sales] = await Promise.all([
    supabase.from("clients").select("id", head).like("carryover_ref", prefix).then(countOf),
    supabase
      .from("clients")
      .select("id", head)
      .like("carryover_ref", prefix)
      .not("user_id", "is", null)
      .then(countOf),
    supabase.from("sales").select("id", head).like("carryover_ref", prefix).then(countOf),
  ]);
  return { clients, sales, signedIn };
}

function ImportCarryoverPage() {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const access = useAdminAccess();
  const { data: studios } = useStudios();
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  // Клубы — пакетные, где сотрудник владелец (переносит только владелец).
  const clubs = (studios ?? []).filter(
    (s) => s.format === "packages" && access?.studios[s.id]?.owner,
  );
  const [studioId, setStudioId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [debtDue, setDebtDue] = useState(DEFAULT_DEBT_DUE);
  const [file, setFile] = useState<{ name: string; data: CarryoverParse } | null>(null);
  const [reading, setReading] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [removing, setRemoving] = useState(false);

  const catalogIds = useCatalogStudioIds(clubs[0]?.id ?? null);
  const { data: memberships = [], isFetched } = useQuery({
    queryKey: ["memberships", "carryover-import", catalogIds?.join(",")],
    queryFn: () =>
      unwrap<{ id: string; name: string }[]>(
        supabase
          .from("memberships")
          .select("id, name")
          .in("studio_id", catalogIds!)
          .eq("kind", "carryover")
          .order("name"),
      ),
    enabled: !!catalogIds && catalogIds.length > 0,
    meta: { errorMessage: "Не удалось загрузить абонементы переноса" },
  });
  // Абонемент переноса обычно один — подставляется сам.
  if (!membershipId && memberships[0]) setMembershipId(memberships[0].id);

  const status = useQuery({
    queryKey: ["carryover_import_status", studioId],
    queryFn: () => fetchStatus(studioId),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить состояние переноса" },
  });

  const pick = async (f: File) => {
    setReading(true);
    setRun(null);
    try {
      // Читалка Excel — только на этой странице.
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const book = await readXlsxFile(f);
      const sheet = book.find((s) => s.data.length > 1) ?? book[0];
      setFile({ name: f.name, data: parseCarryoverSheet(sheet.data as unknown as Cell[][]) });
    } catch (e) {
      setFile(null);
      toast.error(
        `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}. Нужен .xlsx (старый .xls пересохраните в .xlsx).`,
      );
    } finally {
      setReading(false);
    }
  };

  const club = clubs.find((s) => s.id === studioId) ?? null;
  const membership = memberships.find((m) => m.id === membershipId) ?? null;
  const summary = file ? summarizeCarryover(file.data.rows, today) : null;
  const running = run?.running ?? false;

  const start = async (from = 0) => {
    if (!file || !club || !membership) return;
    if (summary && summary.withDebt > 0 && !debtDue) {
      toast.error("Укажите, до какого дня внести долги");
      return;
    }
    const chunks = carryoverChunks(file.data.rows, {
      studioId: club.id,
      membershipId: membership.id,
      debtDue,
    });
    const total = file.data.rows.length;
    if (from === 0) {
      const ok = await confirm({
        title: `Перенести ${nf.format(total)} клиентов в «${club.name}»?`,
        description: `Каждому — «${membership.name}» с остатком и сроком из файла${
          summary && summary.withDebt > 0 ? `, долги — платежом до ${formatDate(debtDue)}` : ""
        }. Клиент с тем же телефоном, что уже есть в базе клубов, получит абонемент в свою карточку. Уже перенесённое пропускается — повторный запуск ничего не задвоит.`,
        confirmLabel: "Перенести",
        destructive: false,
      });
      if (!ok) return;
    }
    let result = from === 0 || !run ? emptyCarryoverResult() : run.result;
    let done = chunks.slice(0, from).reduce((n, c) => n + c.rows.length, 0);
    setRun({ done, total, result, error: null, next: from, running: true });
    for (let i = from; i < chunks.length; i++) {
      const { data, error } = await supabase.rpc("carryover_import_chunk", { p_chunk: chunks[i] });
      if (error) {
        setRun({ done, total, result, error: error.message, next: i, running: false });
        queryClient.invalidateQueries({ queryKey: ["carryover_import_status"] });
        return;
      }
      result = addCarryoverResult(result, data);
      done += chunks[i].rows.length;
      setRun({ done, total, result, error: null, next: i + 1, running: true });
    }
    setRun({ done, total, result, error: null, next: chunks.length, running: false });
    toast.success("Перенос завершён");
    // Новые карточки и абонементы — во всех списках админки.
    queryClient.invalidateQueries();
  };

  const remove = async () => {
    if (!club) return;
    const ok = await confirm({
      title: `Удалить перенесённое в «${club.name}»?`,
      description:
        "Удалятся абонементы переноса этого клуба с долгами и карточки, которые завёл импорт. Карточки, которые были в базе до импорта, останутся. После этого файл можно загрузить заново.",
      confirmLabel: "Удалить перенесённое",
    });
    if (!ok) return;
    setRemoving(true);
    try {
      const { data, error } = await supabase.rpc("carryover_import_rollback", {
        p_studio: club.id,
        p_confirm: "УДАЛИТЬ",
      });
      if (error) throw error;
      const r = (data ?? {}) as { clients?: number; sales?: number };
      toast.success(
        `Удалено: абонементов — ${nf.format(r.sales ?? 0)}, карточек — ${nf.format(r.clients ?? 0)}`,
      );
      setRun(null);
      queryClient.invalidateQueries();
    } catch (e) {
      toast.error("Не удалось удалить: " + (e as Error).message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <AdminShell title="Импорт переноса">
      <div className="max-w-4xl space-y-8">
        <section className="space-y-4 rounded-lg border bg-background p-6">
          <div>
            <h2 className="text-lg font-semibold">Клиенты купленной студии</h2>
            <p className="text-sm text-muted-foreground">
              Выгрузка действующих абонементов прежней студии (.xlsx как есть: «Клиент», «Номер
              телефона», «Номер», «Осталось занятий», «Начало», «Окончание», «Долг»). Каждому
              клиенту — абонемент переноса с его остатком и сроком; срок уже идёт, абонемент
              действует во всех клубах сети.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Клуб" required>
              <Select value={studioId} onValueChange={setStudioId} disabled={running}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите клуб" />
                </SelectTrigger>
                <SelectContent>
                  {clubs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="Абонемент переноса"
              required
              hint={
                isFetched && memberships.length === 0
                  ? "Сначала заведите в «Номенклатурах» номенклатуру с типом «Абонемент переноса»."
                  : undefined
              }
            >
              <Select value={membershipId} onValueChange={setMembershipId} disabled={running}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите абонемент" />
                </SelectTrigger>
                <SelectContent>
                  {memberships.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="Долги внести до"
              tip="Долг клиента станет невнесённым платежом с этой датой; после неё платёж — просроченный."
            >
              <Input
                type="date"
                value={debtDue}
                onChange={(e) => setDebtDue(e.target.value)}
                disabled={running}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) pick(f);
              }}
            />
            <Button
              variant="outline"
              disabled={running || reading}
              onClick={() => inputRef.current?.click()}
            >
              {reading ? <Loader2 className="animate-spin" /> : <FileUp />}
              {file ? "Другой файл" : "Выбрать файл"}
            </Button>
            {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
          </div>

          {file && summary && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Клиентов</dt>
                <dd>{nf.format(summary.rows)}</dd>
                <dt className="text-muted-foreground">Занятий на балансах</dt>
                <dd>{nf.format(summary.visits)}</dd>
                <dt className="text-muted-foreground">С долгом</dt>
                <dd>
                  {nf.format(summary.withDebt)}
                  {summary.withDebt > 0 && ` · ${formatMoney(summary.debtTotal)}`}
                </dd>
                {summary.expired > 0 && (
                  <>
                    <dt className="text-muted-foreground">Срок уже прошёл</dt>
                    <dd>{nf.format(summary.expired)} — переносятся как есть</dd>
                  </>
                )}
              </dl>

              {file.data.problems.length > 0 && (
                <InfoNote variant="warning">
                  <ul className="space-y-0.5">
                    {file.data.problems.map((p) => (
                      <li key={`${p.line}-${p.text}`}>
                        Строка {p.line}, {p.name || "без имени"}: {p.text}
                        {p.skipped && " — не переносится"}
                      </li>
                    ))}
                  </ul>
                </InfoNote>
              )}

              <div className="max-h-[420px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Абонемент в студии</TableHead>
                      <TableHead className="text-right">Осталось</TableHead>
                      <TableHead>Срок</TableHead>
                      <TableHead className="text-right">Долг</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {file.data.rows.map((r) => (
                      <TableRow key={r.ref}>
                        <TableCell className="font-medium">
                          {[r.last_name, r.first_name].filter(Boolean).join(" ")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {r.phone ? formatPhoneDisplay(r.phone) : "—"}
                        </TableCell>
                        <TableCell>{r.membershipName || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.visits}</TableCell>
                        <TableCell
                          className={`whitespace-nowrap tabular-nums ${r.ends_on < today ? "text-rose-600" : ""}`}
                        >
                          {formatDate(r.starts_on)} — {formatDate(r.ends_on)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.debt > 0 ? formatMoney(r.debt) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={running || !club || !membership || summary.rows === 0}
                  onClick={() => start(0)}
                >
                  {running && <Loader2 className="animate-spin" />} Перенести в базу
                </Button>
                {run?.error && !running && (
                  <Button variant="outline" onClick={() => start(run.next)}>
                    Продолжить
                  </Button>
                )}
                {(!club || !membership) && (
                  <span className="text-sm text-muted-foreground">
                    Выберите клуб и абонемент переноса.
                  </span>
                )}
              </div>
            </>
          )}

          {run && <RunProgress run={run} />}
        </section>

        <section className="space-y-4 rounded-lg border bg-background p-6">
          <div>
            <h2 className="text-lg font-semibold">Уже перенесено</h2>
            <p className="text-sm text-muted-foreground">
              Что лежит в базе из выгрузки сейчас — по выбранному клубу. Пока перенесённые клиенты
              не входили в приложение, по их абонементам переноса ничего не списано и долг не
              вносили, перенос можно удалить целиком и загрузить заново.
            </p>
          </div>
          {!studioId ? (
            <InfoNote variant="empty">Выберите клуб выше.</InfoNote>
          ) : status.isLoading || !status.data ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : status.data.sales === 0 ? (
            <InfoNote variant="empty">В этот клуб ещё ничего не перенесено.</InfoNote>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Абонементов переноса</dt>
                <dd>{nf.format(status.data.sales)}</dd>
                <dt className="text-muted-foreground">Новых карточек</dt>
                <dd>{nf.format(status.data.clients)}</dd>
                <dt className="text-muted-foreground">Вошли в приложение</dt>
                <dd>{nf.format(status.data.signedIn)}</dd>
              </dl>
              <Button variant="destructive" disabled={removing || running} onClick={remove}>
                {removing && <Loader2 className="animate-spin" />} Удалить перенесённое
              </Button>
            </>
          )}
        </section>
      </div>
      {confirmDialog}
    </AdminShell>
  );
}

function RunProgress({ run }: { run: Run }) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  const r = run.result;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Перенос клиентов"
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">
          {run.running ? "Переносим" : run.error ? "Остановлено" : "Готово"}: {nf.format(run.done)}{" "}
          из {nf.format(run.total)} клиентов
        </p>
      </div>
      {run.error && (
        <InfoNote variant="warning">
          База не приняла пачку: {run.error}. Уже перенесённое сохранено — исправьте причину и
          нажмите «Продолжить».
        </InfoNote>
      )}
      {run.done > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Новых карточек</dt>
          <dd>{nf.format(r.clients_created)}</dd>
          {r.clients_reused > 0 && (
            <>
              <dt className="text-muted-foreground">Уже были в базе (по телефону)</dt>
              <dd>{nf.format(r.clients_reused)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Абонементов переноса</dt>
          <dd>{nf.format(r.sales_created)}</dd>
          {r.sales_skipped > 0 && (
            <>
              <dt className="text-muted-foreground">Уже были перенесены</dt>
              <dd>{nf.format(r.sales_skipped)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
