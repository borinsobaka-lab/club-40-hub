import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { ChatThread } from "@/components/crm/chat";
import { WaReopenButton } from "@/components/crm/client-chat-panel";
import { DealDialog } from "@/components/crm/deal-dialog";
import { CrmInboxPageSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { CheckboxOption } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CountBadge } from "@/components/ui/status-chip";
import { crmAccountsQuery, findContactDeal, useConversations, useCrmStudios } from "@/lib/crm/data";
import { accountLabel, replyBlock, shortTime } from "@/lib/crm/logic";
import type { CrmConversation } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type Search = { c?: string };

export const Route = createFileRoute("/_authenticated/crm/inbox")({
  head: () => ({ meta: [{ title: "Диалоги — CRM — Base40 Admin" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    c: typeof s.c === "string" ? s.c : undefined,
  }),
  pendingComponent: CrmInboxPageSkeleton,
  component: CrmInboxPage,
});

/**
 * «Диалоги» — переписка со всеми, кто писал в подключённые аккаунты: слева
 * диалоги (свежие сверху, непрочитанные выделены), справа переписка. Видны
 * диалоги аккаунтов своих клубов и аккаунтов без клуба.
 */
function CrmInboxPage() {
  const navigate = Route.useNavigate();
  const { c: selectedId } = Route.useSearch();
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const { data: studios = [] } = useCrmStudios();
  const [accountId, setAccountId] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data: conversations, isLoading } = useConversations({ accountId, unreadOnly });
  const [dealId, setDealId] = useState<string | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const selected = conversations?.find((c) => c.id === selectedId) ?? null;
  const account = selected ? accountMap.get(selected.account_id) : undefined;
  const now = new Date();

  const select = (id: string | undefined) => void navigate({ search: { c: id }, replace: true });

  const openDeal = async (conv: CrmConversation) => {
    try {
      const id = await findContactDeal(conv.contact_id);
      if (id) setDealId(id);
      else toast.info("У этого контакта нет сделки");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось найти сделку");
    }
  };

  return (
    <AdminShell title="Диалоги">
      <div className="flex h-full min-h-0 overflow-hidden rounded-lg border bg-background">
        {/* Список диалогов; на телефоне скрыт, пока открыт диалог */}
        <div
          className={cn(
            "flex w-full flex-col md:w-80 md:shrink-0 md:border-r",
            selectedId && "max-md:hidden",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            {accounts.length > 1 && (
              <Select
                value={accountId || "all"}
                onValueChange={(v) => setAccountId(v === "all" ? "" : v)}
              >
                <SelectTrigger aria-label="Аккаунт" className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все аккаунты</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <CheckboxOption checked={unreadOnly} onCheckedChange={setUnreadOnly} className="px-1">
              Непрочитанные
            </CheckboxOption>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (conversations ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {accounts.length === 0 ? (
                  <>
                    Каналы ещё не подключены. Подключите первый в{" "}
                    <Link to="/crm/settings" className="text-link underline">
                      настройках CRM
                    </Link>
                    .
                  </>
                ) : unreadOnly ? (
                  "Непрочитанных нет."
                ) : (
                  "Пока никто не писал."
                )}
              </p>
            ) : (
              conversations!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 border-b px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted",
                    c.id === selectedId && "bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        c.unread_count > 0 ? "font-semibold" : "font-medium",
                      )}
                    >
                      {c.contact?.name ?? "Без имени"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {shortTime(c.last_message_at, now)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        c.unread_count > 0 ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c.last_direction === "out" ? "Вы: " : ""}
                      {c.last_message_text || "…"}
                    </span>
                    {c.unread_count > 0 && <CountBadge count={c.unread_count} />}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {accountLabel(accountMap.get(c.account_id))}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Переписка */}
        <div className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden md:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b px-2 py-2 sm:px-4">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label="К списку диалогов"
                  onClick={() => select(undefined)}
                >
                  <ChevronLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {selected.contact?.name ?? "Без имени"}
                    {selected.identity?.username && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        @{selected.identity.username}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {accountLabel(account)}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void openDeal(selected)}>
                  Сделка
                </Button>
              </div>
              <ChatThread
                key={selected.id}
                conversationId={selected.id}
                contactName={selected.contact?.name}
                studioName={studios.find((s) => s.id === selected.studio_id)?.name}
                disabledReason={replyBlock(account, selected.last_inbound_at)}
                disabledAction={
                  <WaReopenButton
                    conversation={selected}
                    account={account}
                    contactName={selected.contact?.name ?? null}
                    studioName={studios.find((s) => s.id === selected.studio_id)?.name}
                  />
                }
              />
            </>
          ) : (
            <div className="m-auto p-6 text-center text-sm text-muted-foreground">
              {selectedId && isLoading ? "Загрузка…" : "Выберите диалог слева."}
            </div>
          )}
        </div>
      </div>
      <DealDialog dealId={dealId} onClose={() => setDealId(null)} />
    </AdminShell>
  );
}
