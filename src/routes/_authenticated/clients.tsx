import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Plus, Loader2, Pencil, Trash2, Search, CalendarIcon, Eye } from "lucide-react";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";
import { clientNameClass } from "@/components/client-name-link";
import { cn } from "@/lib/utils";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, useServerPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ClientCardDialog } from "@/components/client-card-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import { type ClubStatus } from "@/lib/client-status";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { formatDate, sanitizeSearch } from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Клиенты — Base40 Admin" }] }),
  component: ClientsPage,
});

type Client = {
  id: string;
  studio_id: string;
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
  "id, studio_id, full_name, first_name, last_name, phone, email, birthday, gender, " +
  "notes, registration_date, last_visit_date, crm_link, photo_url, created_at, club_status";

function displayName(c: Pick<Client, "first_name" | "last_name" | "full_name">) {
  const composed = [c.last_name, c.first_name].filter(Boolean).join(" ").trim();
  return composed || c.full_name || "—";
}

const GENDERS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
];

function genderLabel(v: string | null) {
  return GENDERS.find((g) => g.value === v)?.label ?? "—";
}

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function DateRangeFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateRange | undefined;
  onChange: (v: DateRange | undefined) => void;
}) {
  // Компактный формат дат, чтобы плашка фильтров оставалась одной строкой.
  const text = value?.from
    ? value.to
      ? `${format(value.from, "dd.MM.yy", { locale: ru })}–${format(value.to, "dd.MM.yy", { locale: ru })}`
      : `от ${format(value.from, "dd.MM.yy", { locale: ru })}`
    : label;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 justify-start px-2.5 text-left font-normal",
            !value?.from && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          locale={ru}
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

function ClientsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
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

  const debouncedSearch = useDebouncedValue(search);
  const pg = useServerPagination();
  const { from, to, setTotal, setPage } = pg;

  // DateRange — новый объект на каждый выбор, поэтому в зависимостях эффектов
  // используем строковые ключи, а не сами объекты.
  const regKey = `${regRange?.from?.toISOString() ?? ""}|${regRange?.to?.toISOString() ?? ""}`;
  const visitKey = `${visitRange?.from?.toISOString() ?? ""}|${visitRange?.to?.toISOString() ?? ""}`;
  const hasFilters = Boolean(
    debouncedSearch.trim() || genderFilter || statusFilter || regKey !== "|" || visitKey !== "|",
  );

  // Смена фильтров возвращает на первую страницу: иначе можно остаться,
  // например, на пятой странице результата, где всего одна.
  useEffect(() => {
    setPage(1);
  }, [studioId, debouncedSearch, genderFilter, statusFilter, regKey, visitKey, setPage]);

  const fetchClients = useCallback(async () => {
    if (!studioId) {
      setClients([]);
      setTotal(0);
      return;
    }
    setLoading(true);

    let query = supabase
      .from("clients_with_status")
      .select(CLIENT_COLUMNS, { count: "exact" })
      .eq("studio_id", studioId);

    const term = sanitizeSearch(debouncedSearch);
    if (term) {
      query = query.or(`search_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
    }
    if (genderFilter) query = query.eq("gender", genderFilter);
    if (statusFilter) query = query.eq("club_status", statusFilter);
    if (regRange?.from) query = query.gte("registration_date", toISODate(regRange.from));
    if (regRange?.to) query = query.lte("registration_date", toISODate(regRange.to));
    if (visitRange?.from) query = query.gte("last_visit_date", toISODate(visitRange.from));
    if (visitRange?.to) query = query.lte("last_visit_date", toISODate(visitRange.to));

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить клиентов: " + error.message);
      return;
    }
    setClients((data as unknown as Client[]) ?? []);
    setTotal(count ?? 0);
    // regRange/visitRange намеренно заменены на regKey/visitKey — см. выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, debouncedSearch, genderFilter, statusFilter, regKey, visitKey, from, to, setTotal]);

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchClients();
  }, [fetchClients, refreshSignal]);

  const handleDelete = async (c: Client) => {
    if (
      !(await confirm({
        title: "Удалить клиента?",
        description: `«${displayName(c)}» будет удалён вместе с историей. Действие необратимо.`,
      }))
    )
      return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Клиент удалён");
    fetchClients();
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
    setGenderFilter("");
    setStatusFilter("");
    setRegRange(undefined);
    setVisitRange(undefined);
  };

  return (
    <AdminShell
      title="Клиенты"
      description="База клиентов студии"
      actions={
        <Button size="default" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить клиента
        </Button>
      }
    >
      <div className="space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <TableToolbar>
              <ToolbarSearch
                value={search}
                onChange={setSearch}
                placeholder="Поиск по имени, телефону, email"
              />
              <Select value={genderFilter} onValueChange={setGenderFilter}>
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue placeholder="Пол" />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[150px]">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chk">ЧК — Член клуба</SelectItem>
                  <SelectItem value="pchk">ПЧК — Потенциальный</SelectItem>
                  <SelectItem value="bchk">БЧК — Бывший</SelectItem>
                </SelectContent>
              </Select>
              <DateRangeFilter label="Регистрация" value={regRange} onChange={setRegRange} />
              <DateRangeFilter label="Визит" value={visitRange} onChange={setVisitRange} />
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 shrink-0">
                Сбросить
              </Button>
            </TableToolbar>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">Клиент</TableHead>
                    <TableHead className="w-[80px]">Статус</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Пол</TableHead>
                    <TableHead>Дата рождения</TableHead>
                    <TableHead>Регистрация</TableHead>
                    <TableHead>Последний визит</TableHead>
                    <TableHead>Заметки</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableSkeletonRows columns={9} />
                  ) : clients.length === 0 ? (
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
                    clients.map((c) => (
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
                                {displayName(c)}
                              </button>
                              {c.crm_link && <AmoCrmLinkIcon href={c.crm_link} />}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ClubStatusBadge status={c.club_status ?? "pchk"} />
                          </TableCell>
                          <TableCell>{c.phone ?? "—"}</TableCell>
                          <TableCell>{c.email ?? "—"}</TableCell>
                          <TableCell>{genderLabel(c.gender)}</TableCell>
                          <TableCell>{formatDate(c.birthday)}</TableCell>
                          <TableCell>{formatDate(c.registration_date)}</TableCell>
                          <TableCell>{formatDate(c.last_visit_date)}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">
                            {c.notes ?? "—"}
                          </TableCell>
                        </TableRow>
                      </RowContextMenu>
                    ))
                  )}
                </TableBody>
              </Table>
              <DataPagination {...pg} />
            </div>
          </>
        )}
      </div>

      <ClientDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        client={editing}
        onSaved={fetchClients}
      />

      <ClientCardDialog
        open={cardOpen}
        onOpenChange={setCardOpen}
        client={cardClient}
        onEdit={(c) => {
          setCardOpen(false);
          setEditing(c as Client);
          setOpen(true);
        }}
      />
      {confirmDialog}
    </AdminShell>
  );
}

function ClientDialog({
  open,
  onOpenChange,
  studioId,
  client,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  client: Client | null;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [registrationDate, setRegistrationDate] = useState("");
  const [lastVisitDate, setLastVisitDate] = useState("");
  const [crmLink, setCrmLink] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // Backfill from full_name when first/last are missing (legacy rows).
      let fn = client?.first_name ?? "";
      let ln = client?.last_name ?? "";
      if (!fn && !ln && client?.full_name) {
        const parts = client.full_name.trim().split(/\s+/);
        fn = parts[0] ?? "";
        ln = parts.slice(1).join(" ");
      }
      setFirstName(fn);
      setLastName(ln);
      setPhone(client?.phone ?? "");
      setEmail(client?.email ?? "");
      setBirthday(client?.birthday ?? "");
      setGender(client?.gender ?? "");
      setNotes(client?.notes ?? "");
      setRegistrationDate(client?.registration_date ?? "");
      setLastVisitDate(client?.last_visit_date ?? "");
      setCrmLink(client?.crm_link ?? "");
      setPhotoUrl(client?.photo_url ?? "");
    }
  }, [open, client]);

  const handleSave = async () => {
    if (!studioId) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn && !ln) {
      toast.error("Укажите имя или фамилию");
      return;
    }
    setSaving(true);
    const fullName = [ln, fn].filter(Boolean).join(" ");
    const payload = {
      studio_id: studioId,
      first_name: fn || null,
      last_name: ln || null,
      full_name: fullName,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birthday: birthday || null,
      gender: gender || null,
      notes: notes.trim() || null,
      registration_date: registrationDate || null,
      last_visit_date: lastVisitDate || null,
      crm_link: crmLink.trim() || null,
      photo_url: photoUrl.trim() || null,
    };
    const { error } = client
      ? await supabase.from("clients").update(payload).eq("id", client.id)
      : await supabase.from("clients").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(client ? "Клиент обновлён" : "Клиент добавлен");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? "Редактировать клиента" : "Новый клиент"}</DialogTitle>
          <DialogDescription>Контактные данные и заметки по клиенту.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={`${lastName} ${firstName}`.trim() || "Фото клиента"}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-medium text-muted-foreground">
                  {(firstName || lastName || "?").trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cl-last-name">Фамилия</Label>
                <Input
                  id="cl-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-first-name">Имя *</Label>
                <Input
                  id="cl-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cl-crm">Ссылка на amoCRM</Label>
            <Input
              id="cl-crm"
              type="url"
              value={crmLink}
              onChange={(e) => setCrmLink(e.target.value)}
              placeholder="https://your-account.amocrm.ru/contacts/detail/..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-phone">Телефон</Label>
              <Input id="cl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-email">Email</Label>
              <Input
                id="cl-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-bday">Дата рождения</Label>
              <Input
                id="cl-bday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Пол</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-reg">Дата регистрации</Label>
              <Input
                id="cl-reg"
                type="date"
                value={registrationDate}
                onChange={(e) => setRegistrationDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-last">Последний визит</Label>
              <Input
                id="cl-last"
                type="date"
                value={lastVisitDate}
                onChange={(e) => setLastVisitDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-photo">Фото (URL)</Label>
            <Input
              id="cl-photo"
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-notes">Заметки</Label>
            <Textarea
              id="cl-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
