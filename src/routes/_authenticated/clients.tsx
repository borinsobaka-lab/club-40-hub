import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Plus, Loader2, Pencil, Trash2, Search, ExternalLink, CalendarIcon } from "lucide-react";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { ClientCardDialog } from "@/components/client-card-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import { computeClubStatus, type ClubStatus, type MembershipLite } from "@/lib/client-status";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Клиенты — CLUB 40 Admin" }] }),
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
  avatar_url: string | null;
  created_at: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

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

function inDateRange(value: string | null, range: DateRange | undefined) {
  if (!range || (!range.from && !range.to)) return true;
  if (!value) return false;
  const from = range.from ? toISODate(range.from) : null;
  const to = range.to ? toISODate(range.to) : null;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
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
  const text = value?.from
    ? value.to
      ? `${format(value.from, "dd.MM.yyyy", { locale: ru })} — ${format(value.to, "dd.MM.yyyy", { locale: ru })}`
      : `от ${format(value.from, "dd.MM.yyyy", { locale: ru })}`
    : label;

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-[260px] justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !value?.from && "text-muted-foreground")}>{text}</span>
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
    </div>
  );
}

function formatDate(v: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ru-RU");
  } catch {
    return v;
  }
}

function ClientsPage() {
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
  const [statusByClient, setStatusByClient] = useState<Record<string, ClubStatus>>({});

  const openCard = (c: Client) => {
    setCardClient(c);
    setCardOpen(true);
  };

  const fetchClients = async () => {
    if (!studioId) {
      setClients([]);
      setStatusByClient({});
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить клиентов: " + error.message);
      return;
    }
    const list = (data as Client[]) ?? [];
    setClients(list);

    // Подтягиваем абонементы для статусов ЧК / ПЧК / БЧК
    const { data: cmData } = await supabase
      .from("client_memberships")
      .select("client_id, status, ends_at")
      .eq("studio_id", studioId);
    const memberships = (cmData as MembershipLite[]) ?? [];
    const byClient = new Map<string, MembershipLite[]>();
    for (const m of memberships) {
      if (!m.client_id) continue;
      const arr = byClient.get(m.client_id) ?? [];
      arr.push(m);
      byClient.set(m.client_id, arr);
    }
    const next: Record<string, ClubStatus> = {};
    for (const c of list) {
      next[c.id] = computeClubStatus(byClient.get(c.id));
    }
    setStatusByClient(next);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);


  const handleDelete = async (c: Client) => {
    if (!confirm(`Удалить клиента «${displayName(c)}»?`)) return;
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

  const q = search.trim().toLowerCase();
  const filtered = clients.filter((c) => {
    const name = displayName(c).toLowerCase();
    if (q && !(
      name.includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    )) return false;
    if (genderFilter && c.gender !== genderFilter) return false;
    if (statusFilter && statusByClient[c.id] !== statusFilter) return false;
    if (!inDateRange(c.registration_date, regRange)) return false;
    if (!inDateRange(c.last_visit_date, visitRange)) return false;
    return true;
  });

  const pg = usePagination(filtered);

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
      <div className="mx-auto max-w-6xl space-y-4">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Поиск по имени, телефону, email"
                      className="h-9 pl-9"
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">Пол</Label>
                    <Select value={genderFilter} onValueChange={setGenderFilter}>
                      <SelectTrigger className="h-9 w-[140px]">
                        <SelectValue placeholder="Все" />
                      </SelectTrigger>
                      <SelectContent>
                        {GENDERS.map((g) => (
                          <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">Статус</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-9 w-[160px]">
                        <SelectValue placeholder="Все" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="chk">ЧК — Член клуба</SelectItem>
                        <SelectItem value="pchk">ПЧК — Потенциальный</SelectItem>
                        <SelectItem value="bchk">БЧК — Бывший</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <DateRangeFilter
                    label="Дата регистрации"
                    value={regRange}
                    onChange={setRegRange}
                  />
                  <DateRangeFilter
                    label="Последний визит"
                    value={visitRange}
                    onChange={setVisitRange}
                  />

                  <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9">
                    Сбросить
                  </Button>
                </div>
              </div>
            </div>



            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">ФИО</TableHead>
                    <TableHead className="w-[80px]">Статус</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Пол</TableHead>
                    <TableHead>Дата рождения</TableHead>
                    <TableHead>Регистрация</TableHead>
                    <TableHead>Последний визит</TableHead>
                    <TableHead>CRM</TableHead>
                    <TableHead>Заметки</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                        {clients.length === 0
                          ? "Пока нет клиентов. Нажмите «Добавить клиента»."
                          : "Ничего не найдено."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8">
                              {(c.avatar_url || c.photo_url) && (
                                <AvatarImage
                                  src={c.avatar_url || c.photo_url || ""}
                                  alt={displayName(c)}
                                />
                              )}
                              <AvatarFallback className="text-xs">
                                {initials(displayName(c))}
                              </AvatarFallback>
                            </Avatar>
                            <button
                              type="button"
                              onClick={() => openCard(c)}
                              className="cursor-pointer text-left whitespace-nowrap text-blue-600 underline-offset-2 hover:underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              {displayName(c)}
                            </button>
                            {c.crm_link && <AmoCrmLinkIcon href={c.crm_link} />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ClubStatusBadge status={statusByClient[c.id] ?? "pchk"} />
                        </TableCell>
                        <TableCell>{c.phone ?? "—"}</TableCell>
                        <TableCell>{c.email ?? "—"}</TableCell>
                        <TableCell>{genderLabel(c.gender)}</TableCell>
                        <TableCell>{formatDate(c.birthday)}</TableCell>
                        <TableCell>{formatDate(c.registration_date)}</TableCell>
                        <TableCell>{formatDate(c.last_visit_date)}</TableCell>
                        <TableCell>
                          {c.crm_link ? (
                            <a
                              href={c.crm_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Открыть
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-muted-foreground">
                          {c.notes ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
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
          <DialogDescription>
            Контактные данные и заметки по клиенту.
          </DialogDescription>
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
                <Input id="cl-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-first-name">Имя *</Label>
                <Input id="cl-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cl-crm">Ссылка на amoCRM</Label>
            <Input id="cl-crm" type="url" value={crmLink} onChange={(e) => setCrmLink(e.target.value)} placeholder="https://your-account.amocrm.ru/contacts/detail/..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-phone">Телефон</Label>
              <Input id="cl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-email">Email</Label>
              <Input id="cl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-bday">Дата рождения</Label>
              <Input id="cl-bday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Пол</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-reg">Дата регистрации</Label>
              <Input id="cl-reg" type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-last">Последний визит</Label>
              <Input id="cl-last" type="date" value={lastVisitDate} onChange={(e) => setLastVisitDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-photo">Фото (URL)</Label>
            <Input id="cl-photo" type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-notes">Заметки</Label>
            <Textarea id="cl-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
