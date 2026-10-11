import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toast } from "sonner";
import { Pencil, Trash2, UserPlus, Loader2 } from "lucide-react";

import {
  getEmployeesContext,
  createEmployee,
  updateEmployeeAccess,
  deleteEmployee,
  type EmployeeRow,
} from "@/lib/employees.functions";
import type { StaffRole } from "@/lib/roles";
import {
  CLUB_SECTION_KEYS,
  ADMIN_SECTION_KEYS,
  RAIL_ACCESS_KEYS,
  RAIL_ACCESS_LABEL,
  type ClubSectionKey,
  type AdminSectionKey,
} from "@/lib/admin-access";
import { STUDIO_SECTION_GROUPS } from "@/lib/nav-sections";
import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
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
  DialogForm,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/skeletons";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  email: "При каждом входе на эту почту приходит 6-значный код — пароля нет.",
  role: "Владельцу открыто всё, и только он управляет «Доступами». Администратору и тренеру — разделы, отмеченные ниже.",
  sections:
    "Разделы в левой рейке. «Сотрудники», «Мобильное приложение» и «Скрипты LS» общие для всех студий. Без «Правки скриптов» скрипты только читают, копируют и предлагают изменения.",
};

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Доступы — Base40 Admin" }] }),
  component: EmployeesPage,
});

// Сервер отдаёт только роли сотрудников (member сюда не попадает).
const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Владелец",
  admin: "Админ",
  trainer: "Тренер",
};

type StudioOption = { id: string; name: string };

/**
 * «Доступы» — учётные записи админки и их права: студии, разделы рейки
 * («Клуб», «Сотрудники», «Мобильное приложение») и разделы клуба в каждой
 * студии (lib/admin-access.ts). Раздел только для владельцев (guard в
 * _authenticated/route.tsx); владелец видит и настраивает сотрудников своих
 * студий.
 */
function EmployeesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const getCtx = useServerFn(getEmployeesContext);
  const deleteFn = useServerFn(deleteEmployee);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getCtx(),
  });

  const deleteMut = useMutation({
    mutationFn: (user_id: string) => deleteFn({ data: { user_id } }),
    onSuccess: (res) => {
      toast.success(
        res.accountKept
          ? "Доступ к админке снят. Учётная запись сохранена: человек — клиент или сотрудник другой студии"
          : "Сотрудник удалён",
      );
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const employees = data?.employees ?? [];
  const studios = data?.studios ?? [];
  const studioName = new Map(studios.map((s) => [s.id, s.name]));
  const pg = usePagination(employees);

  const openForm = (employee: EmployeeRow | null) => {
    setEditing(employee);
    setOpen(true);
  };

  return (
    <AdminShell
      title="Доступы"
      actions={
        data ? (
          <Button onClick={() => openForm(null)}>
            <UserPlus />
            Добавить сотрудника
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        {/* Ошибка — текстом вместо таблицы: иначе после неудачной загрузки (и
            повтора) осталась бы пустая таблица, неотличимая от «нет сотрудников». */}
        {error && !data ? (
          <div className="text-sm text-destructive">{error.message}</div>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead tip={TIPS.email}>Email</TableHead>
                  <TableHead tip={TIPS.role}>Роль</TableHead>
                  <TableHead>Студии</TableHead>
                  <TableHead tip={TIPS.sections}>Разделы</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeletonRows columns={5} rows={5} />
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Сотрудники не добавлены
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((e) => (
                    <RowContextMenu
                      key={e.user_id}
                      actions={
                        // Свой доступ не меняем и не удаляем — так владелец не
                        // запрёт сам себя.
                        e.user_id !== data?.currentUserId
                          ? [
                              {
                                label: "Изменить доступ",
                                icon: Pencil,
                                onSelect: () => openForm(e),
                              },
                              {
                                label: "Удалить",
                                icon: Trash2,
                                destructive: true,
                                disabled: deleteMut.isPending,
                                onSelect: async () => {
                                  const ok = await confirm({
                                    title: "Удалить сотрудника?",
                                    description: `${e.full_name ?? e.email} потеряет доступ к админке в ваших студиях.`,
                                  });
                                  if (ok) deleteMut.mutate(e.user_id);
                                },
                              },
                            ]
                          : []
                      }
                    >
                      <TableRow>
                        <TableCell className="font-medium">{e.full_name ?? "—"}</TableCell>
                        <TableCell>{e.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ROLE_LABEL[e.role]}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {e.studios.map((s) => (
                              <Badge key={s.studio_id} variant="outline">
                                {studioName.get(s.studio_id) ?? "—"}
                                {s.role !== "owner" &&
                                  s.sections !== null &&
                                  s.sections.length < CLUB_SECTION_KEYS.length && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {s.sections.length}/{CLUB_SECTION_KEYS.length}
                                    </span>
                                  )}
                              </Badge>
                            ))}
                            {e.otherStudios > 0 && (
                              <span className="text-xs text-muted-foreground">
                                +{e.otherStudios}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{railSummary(e)}</TableCell>
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
            {data && <DataPagination {...pg} />}
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
          <AccessForm
            key={editing?.user_id ?? "new"}
            employee={editing}
            studios={studios}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminShell>
  );
}

function railSummary(e: EmployeeRow) {
  if (e.role === "owner" || e.rail === null) return "Все";
  return e.rail.map((k) => RAIL_ACCESS_LABEL[k]).join(", ") || "—";
}

const ALL_CLUB_SECTIONS = [...CLUB_SECTION_KEYS];

function AccessForm({
  employee,
  studios,
  onDone,
}: {
  employee: EmployeeRow | null;
  studios: StudioOption[];
  onDone: () => void;
}) {
  const createFn = useServerFn(createEmployee);
  const updateFn = useServerFn(updateEmployeeAccess);
  const qc = useQueryClient();
  const activeStudioId = useActiveStudioId();

  const [name, setName] = useState({ first_name: "", last_name: "", email: "" });
  const [role, setRole] = useState<StaffRole>(employee?.role ?? "trainer");
  // Новому сотруднику по умолчанию — «Клуб» целиком в активной студии.
  const [rail, setRail] = useState<AdminSectionKey[]>(
    employee ? (employee.rail ?? [...ADMIN_SECTION_KEYS]) : ["club"],
  );
  const [studioSections, setStudioSections] = useState<Record<string, ClubSectionKey[]>>(() => {
    if (employee) {
      return Object.fromEntries(
        employee.studios.map((s) => [s.studio_id, s.sections ?? ALL_CLUB_SECTIONS]),
      );
    }
    const initial = studios.find((s) => s.id === activeStudioId) ?? studios[0];
    return initial ? { [initial.id]: ALL_CLUB_SECTIONS } : {};
  });
  const [saving, setSaving] = useState(false);

  const isOwnerRole = role === "owner";
  const showClubSections = !isOwnerRole && rail.includes("club");

  // Снятые «Скрипты LS» снимают и их правку.
  const toggleRail = (key: AdminSectionKey, checked: boolean) =>
    setRail((prev) =>
      checked
        ? ADMIN_SECTION_KEYS.filter((k) => k === key || prev.includes(k))
        : prev.filter((k) => k !== key && !(key === "scripts" && k === "scripts-edit")),
    );
  const toggleStudio = (id: string, checked: boolean) =>
    setStudioSections((prev) => {
      const next = { ...prev };
      if (checked) next[id] = ALL_CLUB_SECTIONS;
      else delete next[id];
      return next;
    });
  const setSections = (id: string, sections: ClubSectionKey[]) =>
    setStudioSections((prev) => ({ ...prev, [id]: sections }));

  const handleSave = async () => {
    if (!employee) {
      if (!name.last_name.trim()) {
        toast.error("Укажите фамилию");
        return;
      }
      if (!name.first_name.trim()) {
        toast.error("Укажите имя");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name.email.trim())) {
        toast.error("Укажите корректный email");
        return;
      }
    }
    // Те же правила, что у серверной схемы.
    const selected = studios.filter((s) => studioSections[s.id]);
    if (selected.length === 0) {
      toast.error("Отметьте хотя бы одну студию");
      return;
    }
    if (!isOwnerRole && rail.length === 0) {
      toast.error("Отметьте хотя бы один раздел админки");
      return;
    }
    if (showClubSections && selected.some((s) => studioSections[s.id].length === 0)) {
      toast.error("Отметьте хотя бы один раздел клуба в каждой студии");
      return;
    }

    const access = {
      role,
      rail,
      studios: selected.map((s) => ({ studio_id: s.id, sections: studioSections[s.id] })),
    };
    setSaving(true);
    try {
      if (employee) {
        await updateFn({ data: { user_id: employee.user_id, access } });
        toast.success("Доступ сохранён");
      } else {
        const res = await createFn({ data: { ...name, access } });
        toast.success(
          res.existing
            ? "Доступ выдан. У человека уже была учётная запись — вход по коду на ту же почту"
            : "Сотрудник добавлен. Вход — по коду, который придёт на указанную почту",
        );
      }
      qc.invalidateQueries({ queryKey: ["employees"] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{employee ? "Доступ сотрудника" : "Новый сотрудник"}</DialogTitle>
        <DialogDescription>
          {employee
            ? [employee.full_name, employee.email].filter(Boolean).join(" · ")
            : "Вход в админку — по 6-значному коду, который приходит на эту почту; пароля нет. Если у человека уже есть учётная запись (например, он клиент приложения), ему просто выдаётся доступ."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {!employee && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Фамилия" required>
                    <Input
                      autoComplete="off"
                      value={name.last_name}
                      onChange={(e) => setName({ ...name, last_name: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Имя" required>
                    <Input
                      autoComplete="off"
                      value={name.first_name}
                      onChange={(e) => setName({ ...name, first_name: e.target.value })}
                    />
                  </FormField>
                </div>
                <FormField label="Email" tip={TIPS.email} required>
                  <Input
                    type="email"
                    autoComplete="off"
                    value={name.email}
                    onChange={(e) => setName({ ...name, email: e.target.value })}
                  />
                </FormField>
              </>
            )}

            <FormField label="Роль" tip={TIPS.role} required>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Владелец</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                  <SelectItem value="trainer">Тренер</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {isOwnerRole ? (
              <InfoNote>
                Владельцу открыты все разделы админки и все разделы клуба в отмеченных студиях, а
                также «Доступы» и «Студии».
              </InfoNote>
            ) : (
              <FormField label="Разделы админки" htmlFor={null} tip={TIPS.sections} required>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
                  {RAIL_ACCESS_KEYS.map((key) => (
                    <CheckboxOption
                      key={key}
                      checked={rail.includes(key)}
                      onCheckedChange={(checked) => toggleRail(key, checked)}
                    >
                      {RAIL_ACCESS_LABEL[key]}
                    </CheckboxOption>
                  ))}
                  {rail.includes("scripts") && (
                    <CheckboxOption
                      checked={rail.includes("scripts-edit")}
                      onCheckedChange={(checked) => toggleRail("scripts-edit", checked)}
                    >
                      Правка скриптов
                    </CheckboxOption>
                  )}
                </div>
              </FormField>
            )}

            <FormField
              label="Студии"
              htmlFor={null}
              required
              tip={
                showClubSections
                  ? "Где у сотрудника есть доступ к админке и какие разделы «Клуба» ему видны в каждой студии."
                  : "Где у сотрудника есть доступ к админке: без студии в админку не войти."
              }
            >
              {studios.length === 0 ? (
                <InfoNote variant="empty">Нет студий — заведите их в разделе «Студии».</InfoNote>
              ) : (
                <div className="space-y-2">
                  {studios.map((s) => (
                    <StudioAccess
                      key={s.id}
                      studio={s}
                      sections={studioSections[s.id] ?? null}
                      showSections={showClubSections}
                      onToggle={(checked) => toggleStudio(s.id, checked)}
                      onSectionsChange={(sections) => setSections(s.id, sections)}
                    />
                  ))}
                </div>
              )}
              {!!employee?.otherStudios && (
                <InfoNote>
                  Ещё студий с доступом: {employee.otherStudios}. Там доступ настраивает их владелец
                  — это сохранение их не меняет.
                </InfoNote>
              )}
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {employee ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/** Студия в форме доступа: отметка и, если открыт «Клуб», его разделы. */
function StudioAccess({
  studio,
  sections,
  showSections,
  onToggle,
  onSectionsChange,
}: {
  studio: StudioOption;
  /** null — студия не отмечена. */
  sections: ClubSectionKey[] | null;
  showSections: boolean;
  onToggle: (checked: boolean) => void;
  onSectionsChange: (sections: ClubSectionKey[]) => void;
}) {
  const selected = sections !== null;
  const allChecked = selected && sections.length === CLUB_SECTION_KEYS.length;

  const toggleSection = (key: ClubSectionKey, checked: boolean) => {
    if (!sections) return;
    // Порядок — как в меню, чтобы в базе не копились перестановки.
    onSectionsChange(CLUB_SECTION_KEYS.filter((k) => (k === key ? checked : sections.includes(k))));
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-3 p-3">
        <CheckboxOption checked={selected} onCheckedChange={onToggle} className="font-medium">
          {studio.name}
        </CheckboxOption>
        {selected && showSections && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onSectionsChange(allChecked ? [] : ALL_CLUB_SECTIONS)}
          >
            {allChecked ? "Снять все" : "Выбрать все"}
          </Button>
        )}
      </div>
      {selected && showSections && (
        <div className="space-y-3 border-t p-3">
          {STUDIO_SECTION_GROUPS.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {/* У формата студии своя страница раздела, право одно — одна галочка. */}
                {group.items
                  .filter((item, i, all) => all.findIndex((x) => x.section === item.section) === i)
                  .map((item) => (
                    <CheckboxOption
                      key={item.section}
                      checked={sections.includes(item.section)}
                      onCheckedChange={(checked) => toggleSection(item.section, checked)}
                    >
                      {item.fullTitle ?? item.title}
                    </CheckboxOption>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
