import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import {
  AgreementResolution,
  AgreementResolve,
  AgreementStatusBadge,
} from "@/components/audio/agreements";
import { useConfirm } from "@/components/confirm-dialog";
import { AudioAgreementsPageSkeleton } from "@/components/page-skeletons";
import { RowContextMenu } from "@/components/row-context-menu";
import { TableSkeletonRows } from "@/components/skeletons";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
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
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useTableSort } from "@/hooks/use-table-sort";
import {
  aaAgreementsQuery,
  aaManagersQuery,
  aaRpc,
  invalidateAudio,
  myUserIdQuery,
} from "@/lib/audio/data";
import { AGREEMENTS_COLUMNS, AGREEMENT_STATUS_LABEL, AUDIO_TITLES } from "@/lib/audio/labels";
import { formatOffset } from "@/lib/audio/logic";
import { aaViewAll, type AaAgreement, type AaAgreementStatus } from "@/lib/audio/types";
import { formatDate } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/audio/agreements")({
  head: () => ({ meta: [{ title: "Договорённости — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioAgreementsPageSkeleton,
  component: AgreementsPage,
});

type StatusFilter = AaAgreementStatus | "all";

const TIPS = {
  text: "О чём договорились по итогам разбора смены. Ссылка — на смену и разговор, из-за которого договорились.",
  status: "«Ждёт проверки» всплывает в отчёте следующей смены менеджера с вопросом «Сделали?».",
  result: "Итог ставит тот, кто видит все смены: выполнено, не выполнено или снято, с пояснением.",
};

/**
 * Все договорённости по итогам разборов: открытые и с итогом. Итог ставят
 * прямо здесь (право «все смены») — или в отчёте следующей смены менеджера.
 */
function AgreementsPage() {
  const qc = useQueryClient();
  const access = useAdminAccess();
  const viewAll = aaViewAll(access?.audio);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [managerId, setManagerId] = useState<string | null>(null);
  const { data: managers = [] } = useQuery(aaManagersQuery);
  const { data: myId = null } = useQuery(myUserIdQuery);
  const list = useQuery(aaAgreementsQuery(status, managerId));
  const { confirm, confirmDialog } = useConfirm();
  const sort = useTableSort();
  const rows = sortRows(list.data ?? [], sort.sort, {
    manager: (a) => a.manager_name,
    day: (a) => a.day_date,
    status: (a) => a.status,
  });
  const keys = [null, "manager", "day", "status", null];
  const visibleManagers = viewAll
    ? managers
    : managers.filter((m) => access?.audio?.manager_ids.includes(m.id));

  const remove = async (a: AaAgreement) => {
    if (!(await confirm({ title: "Удалить договорённость?", description: a.text }))) return;
    try {
      await aaRpc("aa_agreement_delete", { p_id: a.id });
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <AdminShell title={AUDIO_TITLES.agreements}>
      <div className="space-y-3">
        <TableToolbar>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger aria-label="Статус договорённости" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AGREEMENT_STATUS_LABEL) as AaAgreementStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {AGREEMENT_STATUS_LABEL[s]}
                </SelectItem>
              ))}
              <SelectItem value="all">Все договорённости</SelectItem>
            </SelectContent>
          </Select>
          {visibleManagers.length > 1 && (
            <Select
              value={managerId ?? "all"}
              onValueChange={(v) => setManagerId(v === "all" ? null : v)}
            >
              <SelectTrigger aria-label="Менеджер" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все менеджеры</SelectItem>
                {visibleManagers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ToolbarReset
            active={status !== "open" || !!managerId}
            onReset={() => {
              setStatus("open");
              setManagerId(null);
            }}
          />
        </TableToolbar>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                {AGREEMENTS_COLUMNS.map((c, i) => (
                  <TableHead
                    key={c}
                    tip={
                      i === 0
                        ? TIPS.text
                        : i === 3
                          ? TIPS.status
                          : i === 4
                            ? TIPS.result
                            : undefined
                    }
                    {...(keys[i] ? sort.head(keys[i]!) : {})}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <TableSkeletonRows columns={AGREEMENTS_COLUMNS.length} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={AGREEMENTS_COLUMNS.length}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {status === "open"
                      ? "Открытых договорённостей нет. Их записывают в отчёте смены по итогам разбора."
                      : "Ничего не найдено"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((a) => (
                  <RowContextMenu
                    key={a.id}
                    actions={
                      viewAll || a.created_by === myId
                        ? [
                            {
                              label: "Удалить",
                              icon: Trash2,
                              destructive: true,
                              onSelect: () => void remove(a),
                            },
                          ]
                        : []
                    }
                  >
                    <TableRow>
                      <TableCell className="min-w-64 whitespace-normal">
                        <div className="text-sm">{a.text}</div>
                        {a.created_by_name && (
                          <div className="text-xs text-muted-foreground">
                            записал {a.created_by_name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{a.manager_name || "—"}</TableCell>
                      <TableCell>
                        <Link
                          to="/audio/$recordingId"
                          params={{ recordingId: a.recording_id }}
                          search={a.dialog_id ? { dialog: a.dialog_id } : {}}
                          className="text-link hover:text-link-hover hover:underline"
                        >
                          {formatDate(a.day_date)}
                          {a.dialog_start_s != null && ` · ${formatOffset(a.dialog_start_s)}`}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <AgreementStatusBadge status={a.status} />
                      </TableCell>
                      <TableCell className="min-w-64 whitespace-normal">
                        <div className="space-y-1">
                          {viewAll && <AgreementResolve key={a.status} agreement={a} />}
                          <AgreementResolution a={a} />
                        </div>
                      </TableCell>
                    </TableRow>
                  </RowContextMenu>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {confirmDialog}
    </AdminShell>
  );
}
