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
import { Textarea } from "@/components/ui/textarea";
import { crmAccountsQuery, invalidateCrm, startTelegramChat } from "@/lib/crm/data";
import { accountLabel } from "@/lib/crm/logic";
import { formatPhone } from "@/lib/format";

const BY_USERNAME = "username";

/**
 * «Написать в Telegram» первым — с личного аккаунта: человека находит
 * Telegram по номеру телефона или @нику, текст свободный (шаблоны и окно
 * 24 часов — только у WhatsApp).
 */
export function TgStartDialog({
  open,
  onOpenChange,
  phones,
  clientId,
  contactName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phones: string[];
  clientId: string | null;
  contactName: string | null;
  onSent?: (conversationId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <Form
            phones={phones}
            clientId={clientId}
            contactName={contactName}
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
  phones,
  clientId,
  contactName,
  onSent,
}: {
  phones: string[];
  clientId: string | null;
  contactName: string | null;
  onSent: (conversationId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: all = [] } = useQuery(crmAccountsQuery);
  const accounts = all.filter((a) => a.kind === "telegram_user" && a.status === "active");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [target, setTarget] = useState(phones[0] ?? BY_USERNAME);
  const [username, setUsername] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  const send = async () => {
    if (!account) return;
    if (target === BY_USERNAME && !username.trim()) {
      toast.error("Укажите @ник в Telegram");
      return;
    }
    if (!body.trim()) {
      toast.error("Напишите сообщение");
      return;
    }
    setSending(true);
    try {
      const id = await startTelegramChat({
        accountId: account.id,
        phone: target === BY_USERNAME ? null : target,
        username: target === BY_USERNAME ? username.trim() : null,
        name: contactName ?? "",
        clientId,
        body: body.trim(),
      });
      await invalidateCrm(qc);
      toast.success("Сообщение отправлено");
      onSent(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Написать в Telegram</DialogTitle>
        <DialogDescription>
          Сообщение уйдёт с личного аккаунта Telegram{contactName ? ` — ${contactName}` : ""}.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void send()}>
        <DialogBody>
          <div className="space-y-4">
            {accounts.length > 1 && (
              <FormField label="С какого аккаунта">
                <Select value={account?.id} onValueChange={setAccountId}>
                  <SelectTrigger aria-label="С какого аккаунта">
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
            <FormField
              label="Кому"
              tip="Telegram находит человека по номеру телефона, если он не скрыл поиск по номеру. Не находит — напишите по @нику."
            >
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger aria-label="Кому">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {phones.map((p) => (
                    <SelectItem key={p} value={p}>
                      {formatPhone(p)}
                    </SelectItem>
                  ))}
                  <SelectItem value={BY_USERNAME}>По @нику</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {target === BY_USERNAME && (
              <FormField label="Ник в Telegram" required>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@username"
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                />
              </FormField>
            )}
            <FormField label="Сообщение" required>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={4096}
                autoFocus
              />
            </FormField>
            <InfoNote>
              Новых переписок с одного аккаунта — немного в день: массовые сообщения незнакомым
              людям Telegram считает спамом и может заблокировать аккаунт. Пишите тем, кто оставил
              номер и ждёт ответа.
            </InfoNote>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={sending || !account}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Отправить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
