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
import { ColorInput } from "@/components/ui/color-input";
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
  connectMetaAccountFn,
  connectTelegramBotFn,
  deleteChannelFn,
  setChannelEnabledFn,
} from "@/lib/crm/channels.functions";
import {
  crmAccountsQuery,
  crmErrorText,
  crmSetupQuery,
  crmTaskTypesQuery,
  crmTemplatesQuery,
  invalidateCrm,
  useCrmStudios,
} from "@/lib/crm/data";
import { CHANNEL_LABEL, NONE } from "@/lib/crm/logic";
import type { CrmChannelAccount, CrmReplyTemplate, CrmTaskType } from "@/lib/crm/types";

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
 * «Каналы» в настройках CRM: подключённые аккаунты мессенджеров —
 * Telegram-бот (токен @BotFather), WhatsApp, Instagram и страница Facebook
 * (токены Meta; вебхук приложения Meta — общий, /api/crm/meta).
 */
export function ChannelsPanel() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: studios = [] } = useCrmStudios();
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState<
    "telegram_bot" | "whatsapp" | "instagram" | "facebook" | null
  >(null);
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
        <div className="flex flex-wrap justify-end gap-1.5">
          {(["telegram_bot", "whatsapp", "instagram", "facebook"] as const).map((k) => (
            <Button key={k} variant="outline" size="xs" onClick={() => setAdding(k)}>
              <Plus />
              {CHANNEL_LABEL[k]}
            </Button>
          ))}
        </div>
      }
    >
      {accounts.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Каналы не подключены. Подключите аккаунт — сообщения ему появятся в «Диалогах», а новые
          обращения станут сделками.
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
                  {a.username ? ` · ${a.kind === "whatsapp" ? "" : "@"}${a.username}` : ""}
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
      <Dialog open={!!adding} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          {adding === "telegram_bot" && <BotForm onDone={() => setAdding(null)} />}
          {adding && adding !== "telegram_bot" && (
            <MetaForm key={adding} kind={adding} onDone={() => setAdding(null)} />
          )}
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

const META_HELP: Record<
  "whatsapp" | "instagram" | "facebook",
  { title: string; text: string; token: string }
> = {
  whatsapp: {
    title: "Подключить WhatsApp",
    text: "Номер из аккаунта WhatsApp Business вашего приложения Meta. После подключения переписка этого номера идёт только здесь.",
    token:
      "Постоянный токен системного пользователя бизнес-портфолио с правами whatsapp_business_messaging и whatsapp_business_management. Хранится только на сервере.",
  },
  instagram: {
    title: "Подключить Instagram",
    text: "Профессиональный аккаунт Instagram, привязанный к странице Facebook. Нужен токен этой страницы.",
    token:
      "Токен доступа страницы Facebook, к которой привязан Instagram (права instagram_manage_messages, pages_manage_metadata). Хранится только на сервере.",
  },
  facebook: {
    title: "Подключить страницу Facebook",
    text: "Сообщения странице в Messenger будут приходить в «Диалоги».",
    token:
      "Токен доступа страницы (права pages_messaging, pages_manage_metadata). Хранится только на сервере.",
  },
};

function MetaForm({
  kind,
  onDone,
}: {
  kind: "whatsapp" | "instagram" | "facebook";
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: studios = [] } = useCrmStudios();
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [name, setName] = useState("");
  const [studio, setStudio] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState(NONE);
  const [saving, setSaving] = useState(false);
  const help = META_HELP[kind];
  const pipelines = (setup?.pipelines ?? []).filter((p) => !p.is_archived);

  const save = async () => {
    if (!token.trim() || (kind === "whatsapp" && (!phoneNumberId.trim() || !wabaId.trim()))) {
      toast.error(
        kind === "whatsapp"
          ? "Заполните токен, Phone number ID и ID аккаунта WhatsApp Business"
          : "Вставьте токен",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await connectMetaAccountFn({
        data: {
          kind,
          name: name.trim(),
          token: token.trim(),
          phoneNumberId: kind === "whatsapp" ? phoneNumberId.trim() : null,
          wabaId: kind === "whatsapp" && wabaId.trim() ? wabaId.trim() : null,
          studioId: studio,
          pipelineId: pipeline === NONE ? null : pipeline,
        },
      });
      await invalidateCrm(qc);
      toast.success(`Подключено: ${res.label}`);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось подключить аккаунт"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{help.title}</DialogTitle>
        <DialogDescription>{help.text}</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Токен доступа" required tip={help.token}>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                autoFocus
              />
            </FormField>
            {kind === "whatsapp" && (
              <>
                <FormField
                  label="Phone number ID"
                  required
                  hint="Кабинет разработчика Meta → WhatsApp → Настройка API: идентификатор номера телефона."
                >
                  <Input
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    inputMode="numeric"
                  />
                </FormField>
                <FormField
                  label="ID аккаунта WhatsApp Business"
                  required
                  hint="Там же. По нему приложение подписывается на сообщения и работают шаблоны."
                >
                  <Input
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    inputMode="numeric"
                  />
                </FormField>
              </>
            )}
            <FormField
              label="Название"
              hint="Как аккаунт подписан в диалогах. Пусто — название из Meta."
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
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
              Отвечать клиенту в этом канале можно в течение 24 часов после его последнего сообщения
              — правило Meta. Написать первым нельзя.
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

const TYPE_COLORS = [
  { hex: "#0ea5e9", label: "Голубой" },
  { hex: "#16a34a", label: "Зелёный" },
  { hex: "#a855f7", label: "Фиолетовый" },
  { hex: "#f59e0b", label: "Янтарный" },
  { hex: "#ef4444", label: "Красный" },
  { hex: "#64748b", label: "Серый" },
];

/** «Типы задач»: что нужно сделать — «Связаться», «Звонок», «Встреча»… */
export function TaskTypesPanel() {
  const qc = useQueryClient();
  const { data: types = [] } = useQuery(crmTaskTypesQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmTaskType | "new" | null>(null);

  const remove = async (t: CrmTaskType) => {
    if (
      !(await confirm({
        title: `Удалить тип «${t.name}»?`,
        description: "Задачи этого типа останутся, но без типа.",
      }))
    )
      return;
    const { error } = await supabase.from("crm_task_types").delete().eq("id", t.id);
    if (error) toast.error(crmErrorText(new Error(error.message)));
    await invalidateCrm(qc);
  };

  return (
    <Panel
      title="Типы задач"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Тип
        </Button>
      }
    >
      {types.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">Типов нет.</p>
      ) : (
        <ul className="divide-y">
          {types.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить тип"
                onClick={() => setEditing(t)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить тип"
                onClick={() => void remove(t)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <TaskTypeForm
              key={editing === "new" ? "new" : editing.id}
              item={editing === "new" ? null : editing}
              nextOrder={types.length + 1}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function TaskTypeForm({
  item,
  nextOrder,
  onDone,
}: {
  item: CrmTaskType | null;
  nextOrder: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(item?.name ?? "");
  const [color, setColor] = useState(item?.color ?? TYPE_COLORS[0].hex);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    try {
      const row = { name: name.trim(), color };
      const { error } = item
        ? await supabase.from("crm_task_types").update(row).eq("id", item.id)
        : await supabase.from("crm_task_types").insert({ ...row, sort_order: nextOrder });
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
        <DialogTitle>{item ? "Изменить тип задачи" : "Новый тип задачи"}</DialogTitle>
        <DialogDescription>
          Тип выбирают при постановке задачи; по нему задачи фильтруются.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoFocus
                placeholder="Звонок"
              />
            </FormField>
            <FormField label="Цвет">
              <ColorInput
                value={color}
                onChange={setColor}
                fallback={TYPE_COLORS[0].hex}
                swatches={TYPE_COLORS}
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
