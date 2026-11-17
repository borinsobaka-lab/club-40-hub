import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  createWaTemplateFn,
  deleteWaTemplateFn,
  syncWaTemplatesFn,
} from "@/lib/crm/channels.functions";
import { crmAccountsQuery, crmErrorText, crmWaTemplatesQuery, invalidateCrm } from "@/lib/crm/data";
import {
  accountLabel,
  fromWaTemplate,
  toWaTemplate,
  WA_STATUS_LABEL,
  waBodyProblem,
  waTemplateName,
} from "@/lib/crm/logic";
import type { CrmChannelAccount, CrmWaTemplate } from "@/lib/crm/types";

const TIPS = {
  name: "Служебное имя шаблона в Meta: латиница, цифры и «_». Клиент его не видит. После удаления одобренного шаблона это имя нельзя занять 30 дней.",
  category:
    "Сервисный — сообщение по делу клиента (запись, напоминание, оплата). Маркетинговый — предложения и акции: дороже, и Meta ограничивает, сколько таких получит один человек. Если текст рекламный, Meta сама переведёт шаблон в маркетинговые.",
  language: "Язык текста. Одно имя шаблона можно завести на нескольких языках.",
  body: "Можно вставлять переменные: {имя} — имя клиента, {клуб} — клуб, {текст} — то, что менеджер впишет при отправке (дата, время, сумма). Текст не должен начинаться или заканчиваться переменной.",
  footer: "Мелкая строка под текстом, до 60 знаков, без переменных.",
};

const tone = (status: string) =>
  status === "APPROVED"
    ? "positive"
    : status === "PENDING" || status === "IN_APPEAL"
      ? "warning"
      : status === "REJECTED" || status === "DISABLED"
        ? "negative"
        : "neutral";

/**
 * «Шаблоны WhatsApp» в настройках CRM. Первым и позже 24 часов после
 * сообщения клиента WhatsApp пропускает только шаблоны, одобренные Meta:
 * здесь их создают (заявка уходит на проверку), видят статус и причину
 * отказа, удаляют. Одобренные доступны в переписке и в «Написать в WhatsApp».
 */
export function WaTemplatesPanel() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: templates = [] } = useQuery(crmWaTemplatesQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const waAccounts = accounts.filter((a) => a.kind === "whatsapp");
  if (waAccounts.length === 0) return null;

  const sync = async () => {
    setBusy("sync");
    try {
      for (const a of waAccounts) await syncWaTemplatesFn({ data: { accountId: a.id } });
      await invalidateCrm(qc);
      toast.success("Статусы обновлены");
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось обновить статусы"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: CrmWaTemplate) => {
    if (
      !(await confirm({
        title: `Удалить шаблон «${t.name}»?`,
        description:
          "Шаблон удалится и в Meta. Имя одобренного шаблона нельзя будет использовать 30 дней.",
      }))
    )
      return;
    setBusy(t.id);
    try {
      await deleteWaTemplateFn({ data: { id: t.id } });
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить шаблон"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
        <h2 className="text-sm font-semibold">Шаблоны WhatsApp</h2>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="xs"
            disabled={busy === "sync"}
            onClick={() => void sync()}
          >
            {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Обновить статусы
          </Button>
          <Button variant="outline" size="xs" onClick={() => setAdding(true)}>
            <Plus />
            Шаблон
          </Button>
        </div>
      </header>
      <p className="border-b px-3 py-2 text-xs text-muted-foreground">
        Чтобы написать клиенту первым или позже 24 часов после его сообщения, WhatsApp требует
        шаблон, одобренный Meta. Проверка занимает до суток; каждое сообщение по шаблону платное.
      </p>
      {templates.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Шаблонов нет. Создайте первый — например, приглашение на пробное занятие.
        </p>
      ) : (
        <ul className="divide-y">
          {templates.map((t) => (
            <li key={t.id} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="font-mono text-xs">{t.name}</span>
                  <StatusChip tone={tone(t.status)} size="sm">
                    {WA_STATUS_LABEL[t.status] ?? t.status.toLowerCase()}
                  </StatusChip>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t.language} · {t.category === "MARKETING" ? "маркетинговый" : "сервисный"}
                    {waAccounts.length > 1
                      ? ` · ${accountLabel(waAccounts.find((a) => a.id === t.account_id))}`
                      : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {fromWaTemplate(t.body, t.vars)}
                </p>
                {t.rejected_reason && (
                  <p className="mt-0.5 text-xs text-destructive">Причина: {t.rejected_reason}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить шаблон"
                title="Удалить шаблон"
                disabled={busy === t.id}
                onClick={() => void remove(t)}
              >
                {busy === t.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          {adding && <TemplateForm accounts={waAccounts} onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
  );
}

function TemplateForm({ accounts, onDone }: { accounts: CrmChannelAccount[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [language, setLanguage] = useState<"ru" | "en" | "ka">("ru");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const converted = toWaTemplate(body.trim());
  const problem = body.trim() ? waBodyProblem(converted.body) : null;

  const insert = (token: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(el?.selectionEnd ?? at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const save = async () => {
    const clean = waTemplateName(name);
    if (clean.length < 3) {
      toast.error("Имя шаблона — латиница, цифры и «_», от 3 знаков");
      return;
    }
    const issue = waBodyProblem(converted.body);
    if (issue) {
      toast.error(issue);
      return;
    }
    setSaving(true);
    try {
      await createWaTemplateFn({
        data: {
          accountId,
          name: clean,
          language,
          category,
          body: body.trim(),
          footer: footer.trim() || null,
        },
      });
      await invalidateCrm(qc);
      toast.success("Шаблон отправлен на проверку Meta");
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось создать шаблон"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новый шаблон WhatsApp</DialogTitle>
        <DialogDescription>
          После сохранения шаблон уходит на проверку Meta (до 24 часов). Изменить текст на проверке
          нельзя — при отказе создайте исправленный шаблон с новым именем.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            {accounts.length > 1 && (
              <FormField label="Номер WhatsApp" required>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger aria-label="Номер WhatsApp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {accountLabel(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Имя шаблона" required tip={TIPS.name}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setName(waTemplateName(name))}
                  placeholder="trial_invite"
                  className="font-mono"
                  maxLength={60}
                  autoFocus
                />
              </FormField>
              <FormField label="Язык" required tip={TIPS.language}>
                <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
                  <SelectTrigger aria-label="Язык">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">Русский</SelectItem>
                    <SelectItem value="ka">Грузинский</SelectItem>
                    <SelectItem value="en">Английский</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField label="Вид" required tip={TIPS.category}>
              <SegmentedControl
                aria-label="Вид шаблона"
                fullWidth
                value={category}
                onChange={setCategory}
                options={[
                  { value: "UTILITY", label: "Сервисный" },
                  { value: "MARKETING", label: "Маркетинговый" },
                ]}
              />
            </FormField>
            <FormField label="Текст" required tip={TIPS.body} error={problem ?? undefined}>
              <div className="space-y-1.5">
                <Textarea
                  ref={area}
                  rows={5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={1024}
                  placeholder="Здравствуйте, {имя}! Это студия {клуб}. Приглашаем вас на пробное занятие — подберём удобное время?"
                />
                <div className="flex flex-wrap gap-1.5">
                  {["{имя}", "{клуб}", "{текст}"].map((v) => (
                    <Button key={v} variant="outline" size="xs" onClick={() => insert(v)}>
                      {v}
                    </Button>
                  ))}
                </div>
              </div>
            </FormField>
            <FormField label="Подпись" optional tip={TIPS.footer}>
              <Input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} />
            </FormField>
            <InfoNote>
              Meta отклоняет шаблоны без понятного смысла, с одними переменными и с обещаниями,
              которые выглядят как спам. Пишите так, как написали бы клиенту лично.
            </InfoNote>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Отправить на проверку
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
