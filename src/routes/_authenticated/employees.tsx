import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus, Loader2 } from "lucide-react";

import { getEmployeesContext, createEmployee, deleteEmployee } from "@/lib/employees.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataPagination, usePagination } from "@/components/data-pagination";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Сотрудники — CLUB 40 Admin" }] }),
  component: EmployeesPage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Админ",
  trainer: "Тренер",
  member: "Участник",
};

function EmployeesPage() {
  const getCtx = useServerFn(getEmployeesContext);
  const createFn = useServerFn(createEmployee);
  const deleteFn = useServerFn(deleteEmployee);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getCtx(),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "trainer" as "owner" | "admin" | "trainer" });

  const createMut = useMutation({
    mutationFn: (input: typeof form) => createFn({ data: input }),
    onSuccess: () => {
      toast.success("Сотрудник добавлен");
      setOpen(false);
      setForm({ full_name: "", email: "", password: "", role: "trainer" });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (user_id: string) => deleteFn({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Сотрудник удалён");
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isOwner = data?.isOwner ?? false;
  const pg = usePagination(data?.employees ?? []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Сотрудники</h1>
          <p className="text-sm text-muted-foreground">
            {isOwner ? "Управление пользователями студии" : "Список пользователей студии (только просмотр)"}
          </p>
        </div>
        {isOwner && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="mr-2 h-4 w-4" />Добавить сотрудника</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новый сотрудник</DialogTitle>
                <DialogDescription>Создайте учётную запись для нового пользователя</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createMut.mutate(form);
                }}
              >
                <div className="space-y-1">
                  <Label>Полное имя</Label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <Label>Пароль</Label>
                  <Input type="text" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <Label>Роль</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Владелец</SelectItem>
                      <SelectItem value="admin">Администратор</SelectItem>
                      <SelectItem value="trainer">Тренер</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMut.isPending}>
                    {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Создать
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Загрузка…</div>}
      {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}

      {data && (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Имя</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.paged.map((e) => (
                <TableRow key={e.user_id}>
                  <TableCell className="font-medium">{e.full_name ?? "—"}</TableCell>
                  <TableCell>{e.email ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{ROLE_LABEL[e.role] ?? e.role}</Badge></TableCell>
                  <TableCell className="text-right">
                    {isOwner && e.user_id !== data.currentUserId && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Удалить ${e.full_name ?? e.email}?`)) deleteMut.mutate(e.user_id);
                        }}
                        disabled={deleteMut.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Сотрудники не добавлены
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <DataPagination {...pg} />
        </div>
      )}
    </div>
  );
}
