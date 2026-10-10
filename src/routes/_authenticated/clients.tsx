import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Plus, Loader2, Pencil, Trash2, CalendarIcon, Eye } from "lucide-react";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";
import { clientNameClass } from "@/components/client-name-link";
import { cn } from "@/lib/utils";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useServerTable } from "@/hooks/use-server-table";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
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
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ClientCardDialog } from "@/components/client-card-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import { CLUB_STATUS_FULL, CLUB_STATUS_LABEL, type ClubStatus } from "@/lib/client-status";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { GENDER_OPTIONS, clientName, formatDate, genderLabel, sanitizeSearch } from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Клиенты — Base40 Admin" }] }),
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
          className={cn(
            "justify-start px-3 text-left font-normal",
            !value?.from && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="text-muted-foreground" />
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
        query = query.or(`search_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
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
            <DateRangeFilter label="Регистрация" value={regRange} onChange={setRegRange} />
            <DateRangeFilter label="Визит" value={visitRange} onChange={setVisitRange} />
            <ToolbarReset active={hasFilters} onReset={resetFilters} />
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

type ClientDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  client: Client | null;
  onSaved: () => void;
};

function ClientDialog(props: ClientDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <ClientForm key={props.client?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

// У старых записей имя и фамилия не разнесены — есть только full_name.
function initialNames(client: Client | null) {
  const first = client?.first_name ?? "";
  const last = client?.last_name ?? "";
  if (first || last || !client?.full_name) return { first, last };
  // full_name везде пишется как «Фамилия Имя» (сохранение ниже, триггер
  // handle_new_user) — первое слово фамилия. Раньше бралось как имя, и
  // сохранение без правок меняло имя и фамилию местами.
  const parts = client.full_name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(1).join(" "), last: parts[0] };
}

function ClientForm({ onOpenChange, studioId, client, onSaved }: ClientDialogProps) {
  const [firstName, setFirstName] = useState(() => initialNames(client).first);
  const [lastName, setLastName] = useState(() => initialNames(client).last);
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [birthday, setBirthday] = useState(client?.birthday ?? "");
  const [gender, setGender] = useState(client?.gender ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [registrationDate, setRegistrationDate] = useState(client?.registration_date ?? "");
  const [lastVisitDate, setLastVisitDate] = useState(client?.last_visit_date ?? "");
  const [crmLink, setCrmLink] = useState(client?.crm_link ?? "");
  const [photoUrl, setPhotoUrl] = useState(client?.photo_url ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studioId) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn && !ln) {
      toast.error("Укажите имя или фамилию");
      return;
    }
    setSaving(true);
    try {
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
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(client ? "Клиент обновлён" : "Клиент добавлен");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{client ? "Редактировать клиента" : "Новый клиент"}</DialogTitle>
        <DialogDescription>Контактные данные и заметки по клиенту.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {/* Аватар слева от имени; на телефоне поля имени уходят в столбик рядом с ним. */}
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={`${lastName} ${firstName}`.trim() || "Фото клиента"}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-medium text-muted-foreground">
                    {(firstName || lastName || "?").trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Фамилия">
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </FormField>
                <FormField label="Имя">
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </FormField>
              </div>
            </div>

            <FormField
              label="Ссылка на amoCRM"
              tip="Карточка контакта в amoCRM. Имя клиента в таблицах станет ссылкой на неё."
              optional
            >
              <Input
                type="url"
                value={crmLink}
                onChange={(e) => setCrmLink(e.target.value)}
                placeholder="https://your-account.amocrm.ru/contacts/detail/..."
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Телефон">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </FormField>
              <FormField
                label="Email"
                tip="Когда клиент зарегистрируется в приложении с этой почтой, его аккаунт привяжется к этой карточке. Проверьте опечатки."
              >
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Дата рождения">
                <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
              </FormField>
              <FormField label="Пол">
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Дата регистрации"
                tip="По ней считаются «новые клиенты» на дашборде. У клиентов из приложения ставится сама."
              >
                <Input
                  type="date"
                  value={registrationDate}
                  onChange={(e) => setRegistrationDate(e.target.value)}
                />
              </FormField>
              <FormField
                label="Последний визит"
                tip="Обновляется сам при отметке посещения. Вручную — только для переноса старой истории."
              >
                <Input
                  type="date"
                  value={lastVisitDate}
                  onChange={(e) => setLastVisitDate(e.target.value)}
                />
              </FormField>
            </div>
            {/* Бакета для фото клиентов нет — поле остаётся ссылкой. */}
            <FormField
              label="Фото (ссылка)"
              tip="Прямая ссылка на картинку. Если аватар вверху не появился — ссылка не на изображение."
              optional
            >
              <Input
                type="url"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://..."
              />
            </FormField>
            <FormField
              label="Заметки"
              tip="Для сотрудников: травмы, договорённости, пожелания. Клиент их изменить не может."
              optional
            >
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
