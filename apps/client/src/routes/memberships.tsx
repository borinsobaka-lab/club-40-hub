import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import {
  Refresh,
  ShieldCheck,
  Lightning,
  ClockCircle,
  Ticket,
  CheckCircle,
} from "@solar-icons/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/memberships")({
  head: () => ({
    meta: [
      { title: "Абонементы — CLUB 40" },
      { name: "description", content: "Абонементы и пакеты занятий CLUB 40." },
    ],
  }),
  component: MembershipsPage,
});

type Membership = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[] | null;
  visits_count: number | null;
  duration_days: number;
  price: number;
  installment_enabled: boolean | null;
  studio_id: string | null;
};

type ActiveMembership = {
  id: string;
  ends_at: string | null;
  visits_left: number | null;
  memberships: { name: string } | null;
};

const COLORS = ["#0ea5e9", "#8b5cf6", "#f43f5e", "#10b981", "#f59e0b", "#ec4899"];
const db = supabase as unknown as {
  from: (table: string) => any;
};

function MembershipsPage() {
  const { user, loading: authLoading } = useAuth();
  const [client, setClient] = useState<{ id: string; studio_id: string } | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [active, setActive] = useState<ActiveMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Membership | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: c, error: cErr } = await db
          .from("clients")
          .select("id, studio_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cErr) throw cErr;
        if (!c || !c.studio_id) {
          if (!cancelled) {
            setClient(null);
            setLoading(false);
            setError("Профиль клиента не привязан к студии. Обратитесь к администратору.");
          }
          return;
        }
        if (cancelled) return;
        setClient({ id: c.id, studio_id: c.studio_id });

        await db.from("profiles").upsert(
          {
            id: user.id,
            studio_id: c.studio_id,
            full_name: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "",
            email: user.email ?? null,
          },
          { onConflict: "id" },
        );

        const membershipSelect =
          "id, name, description, benefits, visits_count, duration_days, price, installment_enabled, studio_id";
        const [{ data: m, error: mErr }, { data: act, error: aErr }] = await Promise.all([
          db
            .from("memberships")
            .select(membershipSelect)
            .eq("studio_id", c.studio_id)
            .order("price", { ascending: true }),
          db
            .from("client_memberships")
            .select("id, ends_at, visits_left, memberships(name)")
            .eq("client_id", c.id)
            .eq("status", "active")
            .maybeSingle(),
        ]);
        if (mErr) throw mErr;
        if (aErr) throw aErr;

        let membershipRows = (m as Membership[]) ?? [];
        if (membershipRows.length === 0) {
          const { data: fallbackMemberships, error: fallbackErr } = await db
            .from("memberships")
            .select(membershipSelect)
            .order("price", { ascending: true });
          if (fallbackErr) throw fallbackErr;
          membershipRows = (fallbackMemberships as Membership[]) ?? [];
        }

        if (cancelled) return;
        setMemberships(membershipRows);
        setActive((act as ActiveMembership) ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Не удалось загрузить абонементы");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const handlePurchase = async () => {
    if (!selected || !client) return;
    if (active) {
      toast.error("У вас уже есть активный абонемент");
      return;
    }
    setPurchasing(true);
    try {
      const { error: insErr } = await db.from("sales").insert({
        studio_id: selected.studio_id ?? client.studio_id,
        client_id: client.id,
        membership_id: selected.id,
        sold_at: new Date().toISOString().slice(0, 10),
        total_amount: selected.price,
        down_payment_amount: selected.price,
        remaining_installments: 0,
        source: "mobile",
      });
      if (insErr) throw insErr;

      const { data: act } = await db
        .from("client_memberships")
        .select("id, ends_at, visits_left, memberships(name)")
        .eq("client_id", client.id)
        .eq("status", "active")
        .maybeSingle();
      setActive((act as ActiveMembership) ?? null);

      toast.success(`Абонемент «${selected.name}» оформлен!`);
      setSelected(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось оформить абонемент");
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Абонементы</h1>
          <p className="text-sm text-white/70">Выберите подходящий пакет занятий</p>
        </div>
      }
    >
      <div className="p-4 space-y-4 pb-24">
        {!user && !authLoading && (
          <Card className="p-4 text-sm text-muted-foreground">
            Войдите в аккаунт, чтобы увидеть абонементы.
          </Card>
        )}

        {(loading || authLoading) && user && (
          <div className="flex items-center justify-center py-12">
            <Refresh className="h-6 w-6 text-muted-foreground animate-spin" weight="BoldDuotone" />
          </div>
        )}

        {error && !loading && (
          <Card className="p-4 text-sm text-destructive">{error}</Card>
        )}

        {!loading && user && active && (
          <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Активный абонемент</div>
                <div className="font-bold">{active.memberships?.name ?? "Абонемент"}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {active.visits_left === null
                    ? "Безлимит посещений"
                    : `Осталось посещений: ${active.visits_left}`}
                  {active.ends_at
                    ? ` · до ${new Date(active.ends_at).toLocaleDateString("ru-RU")}`
                    : ""}
                </div>
              </div>
            </div>
          </Card>
        )}

        {!loading && user && !error && memberships.length === 0 && !active && (
          <Card className="p-4 text-sm text-muted-foreground">
            Пока нет доступных абонементов.
          </Card>
        )}

        {!loading &&
          memberships.map((m, idx) => {
            const color = COLORS[idx % COLORS.length];
            return (
              <button
                key={m.id}
                onClick={() => setSelected({ ...m })}
                className="w-full text-left"
              >
                <Card className="p-4 relative overflow-hidden border-0 shadow-md active:scale-[0.99] transition-transform">
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex items-start justify-between gap-3 pl-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold">{m.name}</h3>
                      {m.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{m.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Lightning className="h-3.5 w-3.5" weight="BoldDuotone" />
                          {m.visits_count === null ? "Безлимит" : `${m.visits_count} занятий`}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ClockCircle className="h-3.5 w-3.5" weight="BoldDuotone" />
                          {m.duration_days} дней
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-black">
                        {Number(m.price).toLocaleString("ru-RU")}₽
                      </div>
                    </div>
                  </div>
                </Card>
              </button>
            );
          })}
      </div>

      {selected && (
        <MembershipDrawer
          membership={selected}
          color={COLORS[memberships.findIndex((x) => x.id === selected.id) % COLORS.length] || COLORS[0]}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onPurchase={handlePurchase}
          purchasing={purchasing}
          disabled={!!active}
        />
      )}
    </PageShell>
  );
}

function MembershipDrawer({
  membership,
  color,
  open,
  onOpenChange,
  onPurchase,
  purchasing,
  disabled,
}: {
  membership: Membership;
  color: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: () => void;
  purchasing: boolean;
  disabled: boolean;
}) {
  const features = [
    membership.visits_count === null
      ? "Безлимит посещений"
      : `${membership.visits_count} занятий`,
    `Срок действия ${membership.duration_days} дней`,
    ...((membership.benefits ?? []).filter(Boolean) as string[]),
  ];

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl bg-background transition-transform duration-300 ${open ? "translate-y-0" : "translate-y-full"}`}
      >
        <div className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
        <div className="overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold leading-tight">{membership.name}</h2>
              {membership.description && (
                <p className="text-sm text-muted-foreground mt-1">{membership.description}</p>
              )}
            </div>
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: color + "20" }}
            >
              <Ticket className="h-7 w-7" style={{ color }} />
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              Абонемент активируется автоматически после оформления
            </span>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Стоимость</div>
              <div className="text-2xl font-black">
                {Number(membership.price).toLocaleString("ru-RU")}₽
              </div>
            </div>
          </div>

          <Button
            onClick={onPurchase}
            disabled={purchasing || disabled}
            className="mt-4 w-full h-14 rounded-full bg-[#FFE500] text-[#1B1C1F] font-bold text-base hover:bg-[#FFE500]/90 active:scale-[0.99] transition disabled:opacity-60"
          >
            {disabled
              ? "У вас уже есть активный абонемент"
              : purchasing
                ? "Оформляем…"
                : "Приобрести"}
          </Button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}
