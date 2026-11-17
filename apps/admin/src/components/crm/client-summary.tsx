import { useQuery } from "@tanstack/react-query";

import { ClubStatusBadge } from "@/components/club-status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { ClubStatus } from "@/lib/client-status";
import { formatDate, todayISO } from "@/lib/format";
import { unwrap } from "@/lib/query";

type Summary = {
  club_status: ClubStatus | null;
  last_visit_date: string | null;
  memberships: {
    id: string;
    status: string;
    ends_at: string | null;
    visits_left: number | null;
    personal_left: number | null;
    memberships: { name: string | null } | null;
  }[];
  overdue: number;
};

/**
 * Клиент клуба в карточке сделки — коротко, чтобы не открывать его карточку:
 * статус клуба, действующие абонементы с остатком и сроком, последний
 * визит, просроченные платежи. Данные портала — что видит сотрудник (RLS).
 */
export function ClientSummary({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["clients", "crm-summary", clientId],
    queryFn: async (): Promise<Summary> => {
      const [client, memberships, overdue] = await Promise.all([
        unwrap<{ club_status: ClubStatus | null; last_visit_date: string | null } | null>(
          supabase
            .from("clients_with_status")
            .select("club_status, last_visit_date")
            .eq("id", clientId)
            .maybeSingle(),
        ),
        unwrap<Summary["memberships"]>(
          supabase
            .from("client_memberships")
            .select("id, status, ends_at, visits_left, personal_left, memberships(name)")
            .eq("client_id", clientId)
            .in("status", ["active", "frozen", "pending"])
            .order("created_at", { ascending: false })
            .limit(5),
        ),
        supabase
          .from("client_packages_list")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .eq("payment_state", "overdue"),
      ]);
      return {
        club_status: client?.club_status ?? null,
        last_visit_date: client?.last_visit_date ?? null,
        memberships,
        overdue: overdue.count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-12 w-full" />;
  // Карточка клиента другого клуба сотруднику не видна — без сводки.
  if (!data) return null;
  const today = todayISO();
  const live = data.memberships.filter(
    (m) => m.status !== "active" || !m.ends_at || m.ends_at >= today,
  );

  return (
    <div className="space-y-1 text-sm">
      {data.club_status && <ClubStatusBadge status={data.club_status} withFull />}
      {live.length === 0 ? (
        <p className="text-muted-foreground">Действующего абонемента нет.</p>
      ) : (
        live.map((m) => {
          const left = [
            m.visits_left ? `осталось ${m.visits_left}` : null,
            m.personal_left ? `персональных ${m.personal_left}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <p key={m.id}>
              <span className="font-medium">{m.memberships?.name ?? "Абонемент"}</span>
              <span className="text-muted-foreground">
                {left ? ` · ${left}` : ""}
                {m.status === "pending"
                  ? " · ждёт очереди"
                  : m.status === "frozen"
                    ? " · заморожен"
                    : m.ends_at
                      ? ` · до ${formatDate(m.ends_at)}`
                      : " · ждёт первого посещения"}
              </span>
            </p>
          );
        })
      )}
      {data.last_visit_date && (
        <p className="text-muted-foreground">Последний визит: {formatDate(data.last_visit_date)}</p>
      )}
      {data.overdue > 0 && <p className="font-medium text-destructive">Просрочен платёж</p>}
    </div>
  );
}
