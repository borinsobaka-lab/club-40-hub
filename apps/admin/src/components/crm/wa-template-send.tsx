import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

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
import {
  crmAccountsQuery,
  crmWaTemplatesQuery,
  invalidateCrm,
  sendWaTemplate,
} from "@/lib/crm/data";
import {
  accountLabel,
  fromWaTemplate,
  renderWaTemplate,
  WA_VAR_LABEL,
  waDefaultValues,
  waPhone,
  waVarCount,
} from "@/lib/crm/logic";
import { formatPhone } from "@/lib/format";

type Target =
  /** В существующий диалог (окно 24 ч закрыто). */
  | { conversationId: string; accountId: string }
  /** Первым — по номеру: диалог заведётся. */
  | { phones: string[]; clientId: string | null };

/**
 * Отправка шаблона WhatsApp — единственный способ написать клиенту первым
 * или после 24 часов молчания: выбор аккаунта и номера (если пишем первыми),
 * одобренного шаблона, значения переменных, «как увидит клиент».
 */
export function WaTemplateDialog({
  open,
  onOpenChange,
  target,
  contactName,
  studioName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  contactName: string | null;
  studioName?: string | null;
  onSent?: (conversationId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <Form
            target={target}
            contactName={contactName}
            studioName={studioName}
            onSent={(id) => {
              onOpenChange(false);
              onSent?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  target,
  contactName,
  studioName,
  onSent,
}: {
  target: Target;
  contactName: string | null;
  studioName?: string | null;
  onSent: (conversationId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: templates = [], isLoading } = useQuery(crmWaTemplatesQuery);
  const starting = "phones" in target;
  const waAccounts = accounts.filter((a) => a.kind === "whatsapp" && a.status === "active");
  const [accountPick, setAccountPick] = useState<string | null>(null);
  const accountId = starting ? (accountPick ?? waAccounts[0]?.id ?? "") : target.accountId;
  const phones = starting ? target.phones.filter((p) => waPhone(p)) : [];
  const [phone, setPhone] = useState(phones[0] ?? "");
  const approved = templates.filter((t) => t.account_id === accountId && t.status === "APPROVED");
  const [templatePick, setTemplatePick] = useState<string | null>(null);
  const template = approved.find((t) => t.id === templatePick) ?? approved[0];
  const [edited, setEdited] = useState<Record<string, string[]>>({});
  const [sending, setSending] = useState(false);

  const count = template ? waVarCount(template.body) : 0;
  const values =
    (template && edited[template.id]) ??
    (template
      ? waDefaultValues(template.vars, count, { name: contactName, studio: studioName })
      : []);

  const send = async () => {
    if (!template) return;
    if (starting && !waPhone(phone)) {
      toast.error("У клиента нет номера телефона");
      return;
    }
    if (values.slice(0, count).some((v) => !v.trim())) {
      toast.error("Заполните все переменные шаблона");
      return;
    }
    setSending(true);
    try {
      const id = await sendWaTemplate({
        templateId: template.id,
        values: values.slice(0, count).map((v) => v.trim()),
        ...(starting
          ? { start: { accountId, phone, name: contactName ?? "", clientId: target.clientId } }
          : { conversationId: target.conversationId }),
      });
      await invalidateCrm(qc);
      toast.success("Шаблон отправлен");
      onSent(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить шаблон");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{starting ? "Написать в WhatsApp" : "Отправить шаблон WhatsApp"}</DialogTitle>
        <DialogDescription>
          Первым и позже 24 часов после сообщения клиента WhatsApp пропускает только одобренные
          шаблоны. Клиент ответит — можно писать свободно.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void send()}>
        <DialogBody>
          <div className="space-y-4">
            {starting && waAccounts.length === 0 ? (
              <InfoNote variant="warning">
                WhatsApp не подключён. Подключите номер в «CRM» → «Настройки» → «Каналы».
              </InfoNote>
            ) : (
              <>
                {starting && waAccounts.length > 1 && (
                  <FormField label="С какого номера">
                    <Select value={accountId} onValueChange={setAccountPick}>
                      <SelectTrigger aria-label="Аккаунт WhatsApp">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {waAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {accountLabel(a)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
                {starting && phones.length > 1 && (
                  <FormField label="На какой номер">
                    <Select value={phone} onValueChange={setPhone}>
                      <SelectTrigger aria-label="Номер клиента">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {phones.map((p) => (
                          <SelectItem key={p} value={p}>
                            {formatPhone(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
                {starting && phones.length === 0 && (
                  <InfoNote variant="warning">У клиента не указан номер телефона.</InfoNote>
                )}
                {isLoading ? null : approved.length === 0 ? (
                  <InfoNote variant="warning">
                    У этого номера нет одобренных шаблонов. Создайте шаблон в «CRM» → «Настройки» →
                    «Шаблоны WhatsApp» и дождитесь проверки Meta.
                  </InfoNote>
                ) : (
                  <>
                    <FormField label="Шаблон" required>
                      <Select value={template?.id ?? ""} onValueChange={setTemplatePick}>
                        <SelectTrigger aria-label="Шаблон">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {approved.map((t) => (
                            <SelectItem key={t.id} value={t.id} textValue={t.name}>
                              {t.name}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {t.language} ·{" "}
                                {t.category === "MARKETING" ? "маркетинг" : "сервисный"}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    {template &&
                      Array.from({ length: count }, (_, i) => (
                        <FormField
                          key={`${template.id}-${i}`}
                          label={`Переменная ${i + 1}${template.vars[i] ? ` — ${WA_VAR_LABEL[template.vars[i]] ?? template.vars[i]}` : ""}`}
                          required
                        >
                          <Input
                            value={values[i] ?? ""}
                            maxLength={200}
                            onChange={(e) =>
                              setEdited((prev) => {
                                const next = [...values];
                                next[i] = e.target.value;
                                return { ...prev, [template.id]: next };
                              })
                            }
                          />
                        </FormField>
                      ))}
                    {template && (
                      <FormField label="Как увидит клиент">
                        <div className="rounded-2xl rounded-br-sm bg-sky-100 px-3 py-2 text-sm whitespace-pre-wrap text-sky-950">
                          {renderWaTemplate(template.body, values) === template.body && count > 0
                            ? fromWaTemplate(template.body, template.vars)
                            : renderWaTemplate(template.body, values)}
                          {template.footer && (
                            <div className="mt-1 text-xs text-sky-950/60">{template.footer}</div>
                          )}
                        </div>
                      </FormField>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="submit"
            disabled={sending || !template || (starting && phones.length === 0)}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Отправить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
