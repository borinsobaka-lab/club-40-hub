import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { ChatThread } from "@/components/crm/chat";
import { StageDot } from "@/components/crm/parts";
import { WaTemplateDialog } from "@/components/crm/wa-template-send";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import {
  createDealForClient,
  crmAccountsQuery,
  crmErrorText,
  crmSetupQuery,
  invalidateCrm,
  useClientConversations,
  useClientDeals,
  useCrmStudios,
} from "@/lib/crm/data";
import { accountLabel, replyBlock, replyWindowOpen } from "@/lib/crm/logic";
import type { CrmChannelAccount, CrmConversation } from "@/lib/crm/types";

export type ChatClient = {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  studioId: string | null;
};

/** Кнопка «Отправить шаблон» под закрытым окном 24 ч WhatsApp. */
export function WaReopenButton({
  conversation,
  account,
  contactName,
  studioName,
}: {
  conversation: CrmConversation;
  account: CrmChannelAccount | undefined;
  contactName: string | null;
  studioName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (account?.kind !== "whatsapp" || account.status !== "active") return null;
  if (replyWindowOpen("whatsapp", conversation.last_inbound_at, new Date())) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Отправить шаблон
      </Button>
      <WaTemplateDialog
        open={open}
        onOpenChange={setOpen}
        target={{ conversationId: conversation.id, accountId: account.id }}
        contactName={contactName}
        studioName={studioName}
      />
    </>
  );
}

/**
 * Переписка с клиентом и его сделки — правая часть карточки клиента (на
 * телефоне — вкладка): менеджер видит абонемент, записи и анкету и тут же
 * отвечает клиенту. Диалоги — всех контактов CRM, привязанных к карточке;
 * вкладка на каждый канал. Нет переписки — «Написать в WhatsApp» шаблоном
 * (в остальные каналы первым написать нельзя — правило мессенджеров).
 */
export function ClientChatPanel({
  client,
  onOpenDeal,
}: {
  client: ChatClient;
  onOpenDeal: (dealId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useStaffProfile();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: studios = [] } = useCrmStudios();
  const { data: conversations, isLoading } = useClientConversations(client.id);
  const { data: deals = [] } = useClientDeals(client.id);
  const [picked, setPicked] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const list = conversations ?? [];
  const conversation =
    list.find((c) => c.id === picked) ?? list.find((c) => c.unread_count > 0) ?? list[0] ?? null;
  const account = accounts.find((a) => a.id === conversation?.account_id);
  const studioName = studios.find(
    (s) => s.id === (conversation?.studio_id ?? client.studioId),
  )?.name;
  const phones = [client.phone, client.phone2].filter((p): p is string => !!p);
  const hasWhatsApp = accounts.some((a) => a.kind === "whatsapp" && a.status === "active");
  const waConversation = list.some(
    (c) => accounts.find((a) => a.id === c.account_id)?.kind === "whatsapp",
  );
  const stageOf = (id: string) => setup?.stages.find((s) => s.id === id);

  const newDeal = async () => {
    const pipeline = setup?.pipelines.find((p) => !p.is_archived);
    const stage = setup?.stages.find((s) => s.pipeline_id === pipeline?.id && s.kind === "open");
    if (!pipeline || !stage) {
      toast.error("В CRM нет воронки — заведите её в настройках CRM");
      return;
    }
    setCreating(true);
    try {
      const id = await createDealForClient({
        clientId: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
        pipelineId: pipeline.id,
        stageId: stage.id,
        studioId: client.studioId,
        responsibleId: me?.id ?? null,
      });
      await invalidateCrm(qc);
      onOpenDeal(id);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось создать сделку"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Сделки клиента */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Сделки:</span>
        {deals
          .filter((d) => !d.closed_at)
          .map((d) => {
            const stage = stageOf(d.stage_id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpenDeal(d.id)}
                title={stage?.name}
                className="flex max-w-48 cursor-pointer items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-muted"
              >
                {stage && <StageDot color={stage.color} className="size-2" />}
                <span className={d.closed_at ? "truncate text-muted-foreground" : "truncate"}>
                  {stage?.name ?? d.title}
                </span>
              </button>
            );
          })}
        {deals.length === 0 && <span className="text-xs text-muted-foreground">нет</span>}
        {deals
          .filter((d) => d.closed_at)
          .map((d) => {
            const stage = stageOf(d.stage_id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpenDeal(d.id)}
                className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {stage?.kind === "won" ? "успешная" : "закрытая"}
              </button>
            );
          })
          .slice(0, 3)}
        <Button variant="ghost" size="xs" disabled={creating} onClick={() => void newDeal()}>
          <Plus />
          Сделка
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
        </div>
      ) : conversation ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2">
            {list.length > 1 ? (
              <SegmentedControl
                aria-label="Канал переписки"
                value={conversation.id}
                onChange={setPicked}
                options={list.map((c) => ({
                  value: c.id,
                  label: accountLabel(accounts.find((a) => a.id === c.account_id)),
                  dot: c.unread_count > 0 ? "есть непрочитанные" : undefined,
                }))}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {accountLabel(account)}
                {conversation.identity?.username ? ` · @${conversation.identity.username}` : ""}
              </span>
            )}
            {hasWhatsApp && !waConversation && phones.length > 0 && (
              <Button
                variant="outline"
                size="xs"
                className="ml-auto shrink-0"
                onClick={() => setWaOpen(true)}
              >
                WhatsApp
              </Button>
            )}
          </div>
          <ChatThread
            key={conversation.id}
            conversationId={conversation.id}
            contactName={client.name}
            studioName={studioName}
            disabledReason={replyBlock(account, conversation.last_inbound_at)}
            disabledAction={
              <WaReopenButton
                conversation={conversation}
                account={account}
                contactName={client.name}
                studioName={studioName}
              />
            }
          />
        </>
      ) : (
        <div className="m-auto max-w-xs space-y-3 p-6 text-center">
          <MessageCircle className="mx-auto size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Переписки с клиентом пока нет. Она появится здесь, когда клиент напишет в подключённый
            мессенджер{hasWhatsApp ? " — или напишите первым в WhatsApp." : "."}
          </p>
          {hasWhatsApp && (
            <Button size="sm" disabled={phones.length === 0} onClick={() => setWaOpen(true)}>
              Написать в WhatsApp
            </Button>
          )}
          {hasWhatsApp && phones.length === 0 && (
            <p className="text-xs text-muted-foreground">У клиента не указан телефон.</p>
          )}
        </div>
      )}
      <WaTemplateDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        target={{ phones, clientId: client.id }}
        contactName={client.name}
        studioName={studioName}
        onSent={setPicked}
      />
    </div>
  );
}
