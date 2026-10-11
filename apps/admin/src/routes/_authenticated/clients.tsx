import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";
import { clientNameClass } from "@/components/client-name-link";

import { CommentCell } from "@/components/comment-cell";
import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useServerTable } from "@/hooks/use-server-table";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
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
import { toast } from "sonner";
import { DataPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ClientCardDialog } from "@/components/client-card-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import {
  CLUB_STATUS_FULL,
  CLUB_STATUS_LABEL,
  CLUB_STATUS_RULE,
  type ClubStatus,
} from "@/lib/client-status";
import { TableSkeletonRows } from "@/components/skeletons";
import {
  GENDER_OPTIONS,
  clientName,
  formatDate,
  genderLabel,
  phoneSearchTerm,
  sanitizeSearch,
} from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";
import { ClientDialog } from "@/components/client-form-dialog";
import { CLIENT_TIPS } from "@/lib/client-fields";
import { formatPhoneDisplay } from "@/lib/contacts";
import { ClientsPageSkeleton } from "@/components/page-skeletons";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  ...CLIENT_TIPS,
  status: (
    <span className="block space-y-1.5">
      {(["chk", "bchk", "pchk"] as const).map((s) => (
        <span key={s} className="block">
          <span className="font-semibold">
            {CLUB_STATUS_LABEL[s]} — {CLUB_STATUS_FULL[s].toLowerCase()}:
          </span>{" "}
          {CLUB_STATUS_RULE[s]}
        </span>
      ))}
    </span>
  ),
};

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Клиенты — Base40 Admin" }] }),
  pendingComponent: ClientsPageSkeleton,
  component: ClientsPage,
});

type Client = {
  id: string;
  studio_id: string;
  // Нужен карточке клиента: по нему грузятся посещения и анкета.
  user_id: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
  created_at: string;
  // Приходит из вью clients_with_status (см. db/performance_indexes.sql).
  club_status: ClubStatus;
};

// Колонки запрашиваем поимённо: во вью есть ещё search_name, который нужен
// только для фильтрации на сервере и незачем гонять по сети.
const CLIENT_COLUMNS =
  "id, studio_id, user_id, full_name, first_name, last_name, phone, email, birthday, gender, " +
  "notes, registration_date, last_visit_date, crm_link, photo_url, created_at, club_status";

const CLUB_STATUSES = Object.keys(CLUB_STATUS_FULL) as ClubStatus[];

// Локальная дата (YYYY-MM-DD): даты регистрации/визита хранятся без времени.
function toISODate(d: Date | undefined) {
  return d ? format(d, "yyyy-MM-dd") : null;
}

function ClientsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [regRange, setRegRange] = useState<DateRange | undefined>();
  const [visitRange, setVisitRange] = useState<DateRange | undefined>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardClient, setCardClient] = useState<Client | null>(null);

  const openCard = (c: Client) => {
    setCardClient(c);
    setCardOpen(true);
  };

  const term = sanitizeSearch(useDebouncedValue(search));
  // Диапазоны — строками: DateRange новый объект на каждый выбор, а строки
  // годятся и для фильтра запроса, и для ключа кэша.
  const regFrom = toISODate(regRange?.from);
  const regTo = toISODate(regRange?.to);
  const visitFrom = toISODate(visitRange?.from);
  const visitTo = toISODate(visitRange?.to);
  const hasFilters = Boolean(
    term || genderFilter || statusFilter || regFrom || regTo || visitFrom || visitTo,
  );

  const table = useServerTable<Client>({
    queryKey: [
      "clients_with_status",
      studioId,
      term,
      genderFilter,
      statusFilter,
      regFrom,
      regTo,
      visitFrom,
      visitTo,
    ],
    queryFn: ({ from, to }) => {
      let query = supabase
        .from("clients_with_status")
        .select(CLIENT_COLUMNS, { count: "exact" })
        .eq("studio_id", studioId!);
      if (term) {
        query = query.or(
          `search_name.ilike.%${term}%,phone.ilike.%${phoneSearchTerm(term)}%,email.ilike.%${term}%`,
        );
      }
      if (genderFilter) query = query.eq("gender", genderFilter);
      if (statusFilter) query = query.eq("club_status", statusFilter);
      if (regFrom) query = query.gte("registration_date", regFrom);
      if (regTo) query = query.lte("registration_date", regTo);
      if (visitFrom) query = query.gte("last_visit_date", visitFrom);
      if (visitTo) query = query.lte("last_visit_date", visitTo);
      return query.order("created_at", { ascending: false }).range(from, to);
    },
    enabled: !!studioId,
    errorMessage: "Не удалось загрузить клиентов",
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["clients_with_status"] });

  const handleDelete = async (c: Client) => {
    if (
      !(await confirm({
        title: "Удалить клиента?",
        description: `«${clientName(c)}» будет удалён вместе с историей. Действие необратимо.`,
      }))
    )
      return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Клиент удалён");
    reload();
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    setOpen(true);
  };

  const resetFilters = () => {
    setSearch("");
    setGenderFilter("");
    setStatusFilter("");
    setRegRange(undefined);
    setVisitRange(undefined);
  };

  return (
    <AdminShell
      title="Клиенты"
      actions={
        <Button onClick={openCreate} disabled={!studioId}>
          <Plus />
          Добавить клиента
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по имени, телефону, email"
            />
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Пол" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                {CLUB_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CLUB_STATUS_LABEL[s]} — {CLUB_STATUS_FULL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangeFilter placeholder="Регистрация" value={regRange} onChange={setRegRange} />
            <DateRangeFilter
              placeholder="Последний визит"
              value={visitRange}
              onChange={setVisitRange}
            />
            <ToolbarReset active={hasFilters} onReset={resetFilters} />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">Клиент</TableHead>
                  <TableHead className="w-[80px]" tip={TIPS.status}>
                    Статус
                  </TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead tip={TIPS.email}>Email</TableHead>
                  <TableHead>Пол</TableHead>
                  <TableHead>Дата рождения</TableHead>
                  <TableHead tip={TIPS.registration}>Регистрация</TableHead>
                  <TableHead tip={TIPS.lastVisit}>Последний визит</TableHead>
                  <TableHead tip={TIPS.notes}>Заметки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.loading ? (
                  <TableSkeletonRows columns={9} />
                ) : table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {hasFilters
                        ? "Ничего не найдено."
                        : "Пока нет клиентов. Нажмите «Добавить клиента»."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((c) => (
                    <RowContextMenu
                      key={c.id}
                      actions={[
                        { label: "Открыть карточку", icon: Eye, onSelect: () => openCard(c) },
                        { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(c) },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(c),
                        },
                      ]}
                    >
                      <TableRow>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openCard(c)}
                              className={clientNameClass}
                            >
                              {clientName(c)}
                            </button>
                            {c.crm_link && <AmoCrmLinkIcon href={c.crm_link} />}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ClubStatusBadge status={c.club_status ?? "pchk"} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {formatPhoneDisplay(c.phone) || "—"}
                        </TableCell>
                        <TableCell>{c.email ?? "—"}</TableCell>
                        <TableCell>{genderLabel(c.gender)}</TableCell>
                        <TableCell>{formatDate(c.birthday)}</TableCell>
                        <TableCell>{formatDate(c.registration_date)}</TableCell>
                        <TableCell>{formatDate(c.last_visit_date)}</TableCell>
                        <TableCell>
                          <CommentCell text={c.notes} />
                        </TableCell>
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...table.pagination} />
          </div>
        </RequireStudio>
      </div>

      <ClientDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        client={editing}
        onSaved={reload}
      />

      <ClientCardDialog
        open={cardOpen}
        onOpenChange={setCardOpen}
        client={cardClient}
        onEdit={(c) => {
          setCardOpen(false);
          setEditing(c);
          setOpen(true);
        }}
      />
      {confirmDialog}
    </AdminShell>
  );
}
