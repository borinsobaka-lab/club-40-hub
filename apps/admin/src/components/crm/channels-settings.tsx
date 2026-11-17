import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { StudioPick } from "@/components/crm/parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  connectTelegramBotFn,
  deleteChannelFn,
  setChannelEnabledFn,
} from "@/lib/crm/channels.functions";
import {
  crmAccountsQuery,
  crmErrorText,
  crmSetupQuery,
  crmTemplatesQuery,
  invalidateCrm,
  useCrmStudios,
} from "@/lib/crm/data";
import { CHANNEL_LABEL, NONE } from "@/lib/crm/logic";
import type { CrmChannelAccount, CrmReplyTemplate } from "@/lib/crm/types";

const TIPS = {
  token:
    "Токен выдаёт @BotFather в Telegram командой /newbot (или /token для существующего бота). Хранится только на сервере: после сохранения его не видно даже вам.",
  studio:
    "Диалоги аккаунта видят сотрудники этого клуба, новые сделки получают этот клуб. Без клуба — видят все, у кого открыт раздел CRM.",
  pipeline: "Куда попадает новое обращение: первый этап этой воронки.",
};

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-background">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * «Каналы» в настройках CRM: подключённые аккаунты мессенджеров. Пока —
 * Telegram-бот (CRM.md, этап 2); остальные каналы появятся здесь же.
 */
export function ChannelsPanel() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: studios = [] } = useCrmStudios();
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (a: CrmChannelAccount, enabled: boolean) => {
    setBusy(a.id);
    try {
      await setChannelEnabledFn({ data: { id: a.id, enabled } });
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось изменить аккаунт"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a: CrmChannelAccount) => {
    if (
      !(await confirm({
        title: `Удалить аккаунт «${a.name}»?`,
        description:
          "Удалятся все его диалоги, сообщения и файлы. Контакты и сделки останутся. Чтобы просто перестать принимать сообщения, выключите аккаунт.",
      }))
    )
      return;
    setBusy(a.id);
    try {
      await deleteChannelFn({ data: { id: a.id } });
      await invalidateCrm(qc);
      toast.success("Аккаунт удалён");
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Каналы"
      action={
        <Button variant="outline" size="xs" onClick={() => setAdding(true)}>
          <Plus />
          Telegram-бот
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Каналы не подключены. Подключите Telegram-бота — сообщения ему появятся в «Диалогах», а
          новые обращения станут сделками.
        </p>
      ) : (
        <ul className="divide-y">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {a.name}
                  <StatusChip
                    tone={
                      a.status === "active"
                        ? "positive"
                        : a.status === "error"
                          ? "warning"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {a.status === "active"
                      ? "работает"
                      : a.status === "error"
                        ? "ошибка"
                        : "выключен"}
                  </StatusChip>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {CHANNEL_LABEL[a.kind]}
                  {a.username ? ` · @${a.username}` : ""}
                  {` · ${studios.find((s) => s.id === a.studio_id)?.name ?? "без клуба"}`}
                  {a.status_note ? ` · ${a.status_note}` : ""}
                </div>
              </div>
              {busy === a.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={a.status !== "disabled"}
                disabled={busy === a.id}
                aria-label={`Принимать сообщения: ${a.name}`}
                onCheckedChange={(v) => void toggle(a, v)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить аккаунт"
                title="Удалить аккаунт"
                disabled={busy === a.id}
                onClick={() => void remove(a)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          {adding && <BotForm onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function BotForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: studios = [] } = useCrmStudios();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [studio, setStudio] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState(NONE);
  const [saving, setSaving] = useState(false);
  const pipelines = (setup?.pipelines ?? []).filter((p) => !p.is_archived);

  const save = async () => {
    if (!token.trim()) {
      toast.error("Вставьте токен бота");
      return;
    }
    setSaving(true);
    try {
      const res = await connectTelegramBotFn({
        data: {
          name: name.trim(),
          token: token.trim(),
          studioId: studio,
          pipelineId: pipeline === NONE ? null : pipeline,
        },
      });
      await invalidateCrm(qc);
      toast.success(res.username ? `Бот @${res.username} подключён` : "Бот подключён");
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось подключить бота"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Подключить Telegram-бота</DialogTitle>
        <DialogDescription>
          Сообщения боту будут приходить в «Диалоги», ответы уходят от имени бота.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Токен бота" required tip={TIPS.token}>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AA…"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                autoFocus
              />
            </FormField>
            <FormField label="Название" hint="Как аккаунт подписан в диалогах. Пусто — имя бота.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Бот Ваке"
                maxLength={80}
              />
            </FormField>
            <FormField label="Клуб" tip={TIPS.studio}>
              <StudioPick value={studio} onChange={setStudio} studios={studios} />
            </FormField>
            <FormField label="Воронка новых обращений" tip={TIPS.pipeline}>
              <Select value={pipeline} onValueChange={setPipeline}>
                <SelectTrigger aria-label="Воронка новых обращений">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Первая воронка</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <InfoNote>
              Если этот бот уже подключён к другой системе (например, к amoCRM), после подключения
              сообщения начнут приходить сюда, а там перестанут.
            </InfoNote>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Подключить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/** «Шаблоны ответов»: готовые тексты для переписки; {имя} и {клуб} подставляются. */
export function TemplatesPanel() {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery(crmTemplatesQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmReplyTemplate | "new" | null>(null);

  const remove = async (t: CrmReplyTemplate) => {
    if (!(await confirm({ title: `Удалить шаблон «${t.title}»?` }))) return;
    const { error } = await supabase.from("crm_reply_templates").delete().eq("id", t.id);
    if (error) toast.error(crmErrorText(new Error(error.message)));
    await invalidateCrm(qc);
  };

  return (
    <Panel
      title="Шаблоны ответов"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Шаблон
        </Button>
      }
    >
      {templates.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Шаблонов нет. Готовый ответ вставляется в переписку одним нажатием.
        </p>
      ) : (
        <ul className="divide-y">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.body}</div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить шаблон"
                onClick={() => setEditing(t)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить шаблон"
                onClick={() => void remove(t)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing && (
            <TemplateForm
              key={editing === "new" ? "new" : editing.id}
              item={editing === "new" ? null : editing}
              nextOrder={templates.length + 1}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function TemplateForm({
  item,
  nextOrder,
  onDone,
}: {
  item: CrmReplyTemplate | null;
  nextOrder: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Заполните название и текст");
      return;
    }
    setSaving(true);
    try {
      const row = { title: title.trim(), body: body.trim() };
      const { error } = item
        ? await supabase.from("crm_reply_templates").update(row).eq("id", item.id)
        : await supabase.from("crm_reply_templates").insert({ ...row, sort_order: nextOrder });
      if (error) throw new Error(error.message);
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Изменить шаблон" : "Новый шаблон ответа"}</DialogTitle>
        <DialogDescription>
          В тексте можно писать {"{имя}"} — подставится имя контакта, и {"{клуб}"} — клуб аккаунта.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Приглашение на пробное"
                maxLength={120}
                autoFocus
              />
            </FormField>
            <FormField label="Текст" required>
              <Textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                placeholder="Здравствуйте, {имя}! …"
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
