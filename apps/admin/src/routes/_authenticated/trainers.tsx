import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, MessageCircle } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { ImageUploadField } from "@/components/image-upload-field";
import { useStudios } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { useStorageUrl } from "@/lib/storage";
import { initials, isHttpUrl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { DataPagination, usePagination } from "@/components/data-pagination";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogForm,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/trainers")({
  head: () => ({ meta: [{ title: "Сотрудники — Base40 Admin" }] }),
  component: StaffPage,
});

/**
 * Сотрудники — общий справочник над студиями (раздел в рейке): тренеры и
 * администраторы (таблица trainers, роль — trainers.role). Один сотрудник
 * может работать в нескольких студиях, они отмечаются в карточке
 * (trainer_studios); в расписании студии выбираются только её сотрудники.
 * Реквизиты (trainer_bank_details) и зарплатные ставки (trainer_pay_rates) —
 * отдельные таблицы: их читают только сотрудники, а тренеров (имя, фото)
 * видят и клиенты в приложении. Доступ в админку — отдельно, в «Доступах».
 */

type StaffRole = "trainer" | "admin";

const ROLES: Record<StaffRole, { label: string; badge: string }> = {
  trainer: { label: "Тренер", badge: "bg-sky-100 text-sky-700" },
  admin: { label: "Администратор", badge: "bg-violet-100 text-violet-700" },
};

type BankCode = "bog" | "tbc" | "credo";

/** iban — код банка в грузинском IBAN (5–6-й знаки): по нему банк подставляется сам. */
const BANKS: { value: BankCode; label: string; iban: string }[] = [
  { value: "bog", label: "Bank of Georgia", iban: "BG" },
  { value: "tbc", label: "TBC", iban: "TB" },
  { value: "credo", label: "Credo", iban: "CD" },
];
const bankLabel = (code: string | null | undefined) =>
  BANKS.find((b) => b.value === code)?.label ?? null;

type BankDetails = {
  bank: BankCode | null;
  account_number: string | null;
  account_holder: string | null;
};

type Employee = {
  id: string;
  full_name: string;
  role: StaffRole;
  photo_url: string | null;
  telegram: string | null;
  trainer_studios: { studio_id: string; studio: { name: string } | null }[];
  // Связь один к одному: PostgREST отдаёт объект, но на всякий случай
  // принимаем и массив.
  bank_details: BankDetails | BankDetails[] | null;
};

const EMPLOYEE_SELECT =
  "id, full_name, role, photo_url, telegram, trainer_studios(studio_id, studio:studios(name)), bank_details:trainer_bank_details(bank, account_number, account_holder)";

function bankOf(e: Employee | null): BankDetails | null {
  const b = e?.bank_details;
  return (Array.isArray(b) ? b[0] : b) ?? null;
}

/** Грузинский IBAN без пробелов, в верхнем регистре. */
const normalizeIban = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/** GE + 2 контрольные цифры + 2 буквы банка + 16 цифр счёта, контрольная сумма mod 97. */
function isValidGeIban(iban: string) {
  if (!/^GE\d{2}[A-Z]{2}\d{16}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** GE29 NB00 0000 0101 9049 17 — как в банковских документах. */
const formatIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** В поле — ссылка целиком или ник (с @ или без). */
function telegramHref(value: string) {
  const nick = value.replace(/^@/, "");
  return isHttpUrl(value) ? value : `https://t.me/${nick}`;
}

function EmployeePhoto({
  value,
  name,
  className,
}: {
  value: string | null;
  name: string;
  className?: string;
}) {
  const src = useStorageUrl("trainers", value);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function RoleBadge({ role }: { role: StaffRole }) {
  const r = ROLES[role] ?? ROLES.trainer;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.badge}`}
    >
      {r.label}
    </span>
  );
}

type TabValue = "staff" | "rates";

function StaffPage() {
  const [tab, setTab] = useState<TabValue>("staff");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["trainers", "all"],
    queryFn: () =>
      unwrap<Employee[]>(supabase.from("trainers").select(EMPLOYEE_SELECT).order("full_name")),
    meta: { errorMessage: "Не удалось загрузить сотрудников" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["trainers"] });

  const openEdit = (e: Employee | null) => {
    setEditing(e);
    setOpen(true);
  };

  return (
    <AdminShell title="Сотрудники">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="staff">Сотрудники</TabsTrigger>
            <TabsTrigger value="rates">Зарплатные ставки</TabsTrigger>
          </TabsList>
          {tab === "staff" && (
            <Button onClick={() => openEdit(null)}>
              <Plus />
              Добавить сотрудника
            </Button>
          )}
        </div>

        <TabsContent value="staff" className="space-y-3">
          <EmployeesTab
            employees={employees}
            loading={isLoading}
            onEdit={openEdit}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="rates" className="space-y-3">
          <PayRatesTab employees={employees} loading={isLoading} />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
          <EmployeeForm
            key={editing?.id ?? "new"}
            employee={editing}
            onClose={() => setOpen(false)}
            onSaved={reload}
          />
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

// ====== Вкладка «Сотрудники» ======

function EmployeesTab({
  employees,
  loading,
  onEdit,
  onChanged,
}: {
  employees: Employee[];
  loading: boolean;
  onEdit: (e: Employee) => void;
  onChanged: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const pg = usePagination(employees);

  const handleDelete = async (e: Employee) => {
    if (
      !(await confirm({
        title: "Удалить сотрудника?",
        description: `«${e.full_name}» будет удалён из всех студий и из расписания вместе с реквизитами и ставками, без возможности восстановления.`,
      }))
    )
      return;
    const { error } = await supabase.from("trainers").delete().eq("id", e.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Сотрудник удалён");
    onChanged();
  };

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Фото</TableHead>
            <TableHead>Имя</TableHead>
            <TableHead>Роль</TableHead>
            <TableHead>Студии</TableHead>
            <TableHead>Telegram</TableHead>
            <TableHead>Банк</TableHead>
            <TableHead>Счёт</TableHead>
            <TableHead>Владелец счёта</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows columns={8} />
          ) : employees.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                Пока нет сотрудников. Нажмите «Добавить сотрудника».
              </TableCell>
            </TableRow>
          ) : (
            pg.paged.map((e) => {
              const bank = bankOf(e);
              return (
                <RowContextMenu
                  key={e.id}
                  actions={[
                    { label: "Редактировать", icon: Pencil, onSelect: () => onEdit(e) },
                    {
                      label: "Удалить",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => handleDelete(e),
                    },
                  ]}
                >
                  <TableRow>
                    <TableCell>
                      <EmployeePhoto value={e.photo_url} name={e.full_name} />
                    </TableCell>
                    <TableCell className="font-medium">{e.full_name}</TableCell>
                    <TableCell>
                      <RoleBadge role={e.role} />
                    </TableCell>
                    <TableCell>
                      {e.trainer_studios.length ? (
                        <div className="flex flex-wrap gap-1">
                          {e.trainer_studios.map((s) => (
                            <Badge key={s.studio_id} variant="secondary">
                              {s.studio?.name ?? "—"}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Не выбраны</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.telegram ? (
                        <a
                          href={telegramHref(e.telegram)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm hover:underline"
                        >
                          <MessageCircle className="h-3.5 w-3.5 text-[#0088cc]" />
                          {e.telegram}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{bankLabel(bank?.bank) ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {bank?.account_number ? formatIban(bank.account_number) : "—"}
                    </TableCell>
                    <TableCell>{bank?.account_holder ?? "—"}</TableCell>
                  </TableRow>
                </RowContextMenu>
              );
            })
          )}
        </TableBody>
      </Table>
      <DataPagination {...pg} />
      {confirmDialog}
    </div>
  );
}

function EmployeeForm({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Отмечать можно студии, где вы сотрудник (так же проверяет RLS);
  // остальные студии сотрудника показаны неактивными и сохраняются как есть.
  const { data: myStudios = [] } = useStudios();
  const bank = bankOf(employee);
  const initialStudioIds = employee?.trainer_studios.map((s) => s.studio_id) ?? [];

  const [role, setRole] = useState<StaffRole>(employee?.role ?? "trainer");
  const [fullName, setFullName] = useState(employee?.full_name ?? "");
  const [telegram, setTelegram] = useState(employee?.telegram ?? "");
  const [photoUrl, setPhotoUrl] = useState(employee?.photo_url ?? null);
  const [studioIds, setStudioIds] = useState<string[]>(initialStudioIds);
  const [bankCode, setBankCode] = useState<string>(bank?.bank ?? "");
  const [accountNumber, setAccountNumber] = useState(
    bank?.account_number ? formatIban(bank.account_number) : "",
  );
  const [accountHolder, setAccountHolder] = useState(bank?.account_holder ?? "");
  const [saving, setSaving] = useState(false);

  const manageable = new Set(myStudios.map((s) => s.id));
  const otherStudios = (employee?.trainer_studios ?? []).filter(
    (s) => !manageable.has(s.studio_id),
  );

  const toggleStudio = (id: string, checked: boolean) =>
    setStudioIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const handleAccountChange = (value: string) => {
    setAccountNumber(value);
    // Банк по коду в IBAN, если его ещё не выбрали руками.
    if (!bankCode) {
      const code = normalizeIban(value).slice(4, 6);
      const match = BANKS.find((b) => b.iban === code);
      if (match) setBankCode(match.value);
    }
  };

  const handleSave = async () => {
    const name = fullName.trim();
    const iban = normalizeIban(accountNumber);
    if (!name) {
      toast.error("Укажите имя");
      return;
    }
    if (studioIds.length === 0) {
      toast.error("Отметьте хотя бы одну студию");
      return;
    }
    if (iban && !isValidGeIban(iban)) {
      toast.error(
        "Номер счёта — грузинский IBAN: GE и 20 знаков, например GE29 NB00 0000 0101 9049 17",
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        full_name: name,
        role,
        telegram: telegram.trim() || null,
        photo_url: photoUrl,
      };
      let id = employee?.id;
      if (id) {
        const { error } = await supabase.from("trainers").update(payload).eq("id", id);
        if (error) {
          toast.error("Ошибка сохранения: " + error.message);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("trainers")
          .insert(payload)
          .select("id")
          .single<{ id: string }>();
        if (error) {
          toast.error("Ошибка сохранения: " + error.message);
          return;
        }
        id = data.id;
      }

      // Строка сотрудника записана: дальше при ошибке закрываем форму
      // (повторное «Сохранить» нового сотрудника завело бы его дважды) и
      // обновляем список.
      const error = await saveLinks(id);
      if (error) toast.error("Сотрудник сохранён, но " + error);
      else toast.success(employee ? "Сохранено" : "Сотрудник добавлен");
      onClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  /** Студии и реквизиты сотрудника. Возвращает текст ошибки. */
  const saveLinks = async (id: string) => {
    // Студии: добавляем отмеченные, снимаем только свои снятые.
    const toAdd = studioIds.filter((s) => !initialStudioIds.includes(s));
    const toRemove = initialStudioIds.filter((s) => manageable.has(s) && !studioIds.includes(s));
    if (toAdd.length) {
      const { error } = await supabase
        .from("trainer_studios")
        .insert(toAdd.map((studio_id) => ({ trainer_id: id, studio_id })));
      if (error) return "студии не привязаны: " + error.message;
    }
    if (toRemove.length) {
      const { error } = await supabase
        .from("trainer_studios")
        .delete()
        .eq("trainer_id", id)
        .in("studio_id", toRemove);
      if (error) return "студии не отвязаны: " + error.message;
    }

    // Реквизиты: все поля пустые — строку удаляем, иначе upsert.
    const iban = normalizeIban(accountNumber);
    const holder = accountHolder.trim();
    const { error } =
      !bankCode && !iban && !holder
        ? await supabase.from("trainer_bank_details").delete().eq("trainer_id", id)
        : await supabase.from("trainer_bank_details").upsert({
            trainer_id: id,
            bank: bankCode || null,
            account_number: iban || null,
            account_holder: holder || null,
            updated_at: new Date().toISOString(),
          });
    return error ? "реквизиты не сохранены: " + error.message : null;
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{employee ? "Редактировать сотрудника" : "Новый сотрудник"}</DialogTitle>
        <DialogDescription>
          Сотрудник общий для студий: отметьте, где он работает, — в расписании студии можно выбрать
          только её сотрудников.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Аватарка" htmlFor={null} optional>
              <ImageUploadField
                bucket="trainers"
                folder="trainers"
                value={photoUrl}
                onChange={setPhotoUrl}
                preview={
                  <EmployeePhoto value={photoUrl} name={fullName || "?"} className="size-16" />
                }
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Имя" tip="Имя тренера клиенты видят в расписании приложения.">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Иван Иванов"
                />
              </FormField>
              <FormField
                label="Роль"
                tip="Кем работает сотрудник. Доступ в админку выдаётся отдельно — в «Доступах»."
              >
                <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLES) as StaffRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLES[r].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField label="Telegram" optional>
              <Input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="@username или ссылка"
              />
            </FormField>

            <FormField
              label="Студии"
              tip="Где работает сотрудник. Только в этих студиях его можно поставить на занятие."
              htmlFor={null}
            >
              {myStudios.length === 0 && otherStudios.length === 0 ? (
                <InfoNote variant="empty">Нет студий — заведите их в разделе «Студии».</InfoNote>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
                  {myStudios.map((s) => (
                    <CheckboxOption
                      key={s.id}
                      checked={studioIds.includes(s.id)}
                      onCheckedChange={(checked) => toggleStudio(s.id, checked)}
                    >
                      {s.name}
                    </CheckboxOption>
                  ))}
                  {otherStudios.map((s) => (
                    <CheckboxOption key={s.studio_id} checked disabled onCheckedChange={() => {}}>
                      {s.studio?.name ?? "Другая студия"}
                    </CheckboxOption>
                  ))}
                </div>
              )}
            </FormField>

            <FormField
              label="Банковские реквизиты"
              htmlFor={null}
              optional
              tip="Для выплат сотруднику. Видят только сотрудники, клиентам в приложении они недоступны."
            >
              <div className="space-y-3 rounded-md border p-3">
                <FormField label="Номер счёта" hint="Грузинский IBAN: GE и 20 знаков">
                  <Input
                    value={accountNumber}
                    onChange={(e) => handleAccountChange(e.target.value)}
                    placeholder="GE00 XX00 0000 0000 0000 00"
                    className="font-mono"
                    autoComplete="off"
                  />
                </FormField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Банк">
                    <Select value={bankCode} onValueChange={setBankCode}>
                      <SelectTrigger>
                        <SelectValue placeholder="Не выбран" />
                      </SelectTrigger>
                      <SelectContent>
                        {BANKS.map((b) => (
                          <SelectItem key={b.value} value={b.value}>
                            {b.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Владелец счёта">
                    <Input
                      value={accountHolder}
                      onChange={(e) => setAccountHolder(e.target.value)}
                      placeholder="Как в банке"
                      autoComplete="off"
                    />
                  </FormField>
                </div>
              </div>
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
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

// ====== Вкладка «Зарплатные ставки» ======

type PayRates = {
  trainer_id: string;
  admin_shift_enabled: boolean;
  admin_shift_rate: number | null;
  group_training_enabled: boolean;
  group_training_rate: number | null;
  personal_training_enabled: boolean;
  personal_training_rate: number | null;
};

/** Ставки: флаг «получает ли сейчас» + сумма в лари за единицу. */
const RATE_KINDS = [
  {
    key: "admin_shift",
    label: "Смена администратора",
    tip: "Сколько сотрудник получает за смену администратором. Включено — он сейчас работает администратором и получает эту ставку.",
  },
  {
    key: "group_training",
    label: "Групповая тренировка",
    tip: "Сколько сотрудник получает за проведённую групповую тренировку.",
  },
  {
    key: "personal_training",
    label: "Персональная тренировка",
    tip: "Сколько сотрудник получает за проведённую персональную тренировку.",
  },
] as const;

type RateKind = (typeof RATE_KINDS)[number]["key"];
type RatePatch = Partial<Omit<PayRates, "trainer_id">>;

function PayRatesTab({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  const queryClient = useQueryClient();
  const { data: rates = [], isLoading: ratesLoading } = useQuery({
    queryKey: ["trainer_pay_rates"],
    queryFn: () => unwrap<PayRates[]>(supabase.from("trainer_pay_rates").select("*")),
    meta: { errorMessage: "Не удалось загрузить зарплатные ставки" },
  });
  const byEmployee = new Map(rates.map((r) => [r.trainer_id, r]));
  const pg = usePagination(employees);

  /** Сохраняет одно изменённое поле; строку ставок заводит при первой правке. */
  const save = async (trainerId: string, patch: RatePatch) => {
    const { data, error } = await supabase
      .from("trainer_pay_rates")
      .upsert({ trainer_id: trainerId, ...patch, updated_at: new Date().toISOString() })
      .select("*")
      .single<PayRates>();
    if (error) {
      toast.error("Ставка не сохранена: " + error.message);
      return false;
    }
    queryClient.setQueryData<PayRates[]>(["trainer_pay_rates"], (prev = []) => [
      ...prev.filter((r) => r.trainer_id !== trainerId),
      data,
    ]);
    return true;
  };

  const busy = loading || ratesLoading;

  return (
    <div className="space-y-3">
      <InfoNote>
        Ставки — в лари за смену или тренировку. Переключатель — получает ли сотрудник эту ставку
        сейчас; сумма сохраняется, когда поле теряет фокус.
      </InfoNote>
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Сотрудник</TableHead>
              {RATE_KINDS.map((k) => (
                <TableHead key={k.key} title={k.tip}>
                  {k.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {busy ? (
              <TableSkeletonRows columns={4} />
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Сначала добавьте сотрудников на вкладке «Сотрудники».
                </TableCell>
              </TableRow>
            ) : (
              pg.paged.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <EmployeePhoto value={e.photo_url} name={e.full_name} className="size-8" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {ROLES[e.role]?.label ?? ROLES.trainer.label}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  {RATE_KINDS.map((k) => (
                    <TableCell key={k.key}>
                      <RateCell
                        kind={k.key}
                        label={`${k.label}: ${e.full_name}`}
                        rates={byEmployee.get(e.id) ?? null}
                        onSave={(patch) => save(e.id, patch)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <DataPagination {...pg} />
      </div>
    </div>
  );
}

/** Ячейка ставки: переключатель «получает» и сумма (правится при включённой ставке). */
function RateCell({
  kind,
  label,
  rates,
  onSave,
}: {
  kind: RateKind;
  label: string;
  rates: PayRates | null;
  onSave: (patch: RatePatch) => Promise<boolean>;
}) {
  const enabled = rates?.[`${kind}_enabled`] ?? false;
  const saved = rates?.[`${kind}_rate`] ?? null;
  const [amount, setAmount] = useState(saved === null ? "" : String(saved));
  const [pending, setPending] = useState(false);

  const run = async (patch: RatePatch) => {
    setPending(true);
    try {
      return await onSave(patch);
    } finally {
      setPending(false);
    }
  };

  const commitAmount = async () => {
    const text = amount.trim().replace(",", ".");
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Ставка — неотрицательное число");
      setAmount(saved === null ? "" : String(saved));
      return;
    }
    if (value === saved) return;
    if (!(await run({ [`${kind}_rate`]: value }))) setAmount(saved === null ? "" : String(saved));
  };

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={enabled}
        disabled={pending}
        aria-label={label}
        onCheckedChange={(checked) => run({ [`${kind}_enabled`]: checked })}
      />
      <div className="relative w-28">
        <Input
          inputMode="decimal"
          value={amount}
          disabled={!enabled || pending}
          aria-label={`${label}, сумма`}
          placeholder="0"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="pr-7 tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          ₾
        </span>
      </div>
    </div>
  );
}
