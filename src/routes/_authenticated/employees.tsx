import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toast } from "sonner";
import { Trash2, UserPlus, Loader2 } from "lucide-react";

import { getEmployeesContext, createEmployee, deleteEmployee } from "@/lib/employees.functions";
import type { StaffRole } from "@/lib/roles";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Сотрудники — Base40 Admin" }] }),
  component: EmployeesPage,
});

// Сервер отдаёт только роли сотрудников (member сюда не попадает).
const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Владелец",
  admin: "Админ",
  trainer: "Тренер",
};

function EmployeesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const getCtx = useServerFn(getEmployeesContext);
  const deleteFn = useServerFn(deleteEmployee);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Студию сервер берёт из профиля сотрудника, поэтому studioId в ключе нет.
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

  const isOwner = data?.isOwner ?? false;
  const employees = data?.employees ?? [];
  const pg = usePagination(employees);

  return (
    <AdminShell
      title="Сотрудники"
      actions={
        isOwner ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus />
                Добавить сотрудника
              </Button>
            </DialogTrigger>
            <DialogContent>
              {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
              <NewEmployeeForm onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
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
                  <TableHead>Email</TableHead>
                  <TableHead>Роль</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeletonRows columns={3} rows={5} />
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                      Сотрудники не добавлены
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((e) => (
                    <RowContextMenu
                      key={e.user_id}
                      actions={
                        isOwner && e.user_id !== data?.currentUserId
                          ? [
                              {
                                label: "Удалить",
                                icon: Trash2,
                                destructive: true,
                                disabled: deleteMut.isPending,
                                onSelect: async () => {
                                  const ok = await confirm({
                                    title: "Удалить сотрудника?",
                                    description: `${e.full_name ?? e.email} потеряет доступ к админке.`,
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
      {confirmDialog}
    </AdminShell>
  );
}

function NewEmployeeForm({ onDone }: { onDone: () => void }) {
  const createFn = useServerFn(createEmployee);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "trainer" as StaffRole,
  });

  const createMut = useMutation({
    mutationFn: (input: typeof form) => createFn({ data: input }),
    onSuccess: (res) => {
      toast.success(
        res.existing
          ? "Роль выдана. У человека уже была учётная запись — вход по ссылке на ту же почту"
          : "Сотрудник добавлен. Вход — по ссылке на указанную почту",
      );
      onDone();
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новый сотрудник</DialogTitle>
        <DialogDescription>
          Вход в админку — по ссылке на эту почту, пароль не нужен. Если у человека уже есть учётная
          запись (например, он клиент приложения), ему просто выдаётся роль.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate(form);
        }}
      >
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label>Полное имя</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Роль</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as StaffRole })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Владелец</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
                <SelectItem value="trainer">Тренер</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className="animate-spin" />}
            Добавить
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
