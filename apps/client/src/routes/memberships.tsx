import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import {
  Refresh,
  ShieldCheck,
  Ticket,
  CheckCircle,
  CloseCircle,
} from "@solar-icons/react";
import { ChevronRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  cover_url: string | null;
  for_couple?: boolean | null;
};

function formatPeriod(days: number): string {
  if (days === 30) return "раз в месяц";
  if (days === 365 || days === 360) return "раз в год";
  if (days > 0 && days % 30 === 0) {
    const months = days / 30;
    const word = months === 1 ? "месяц" : months >= 2 && months <= 4 ? "месяца" : "месяцев";
    return `раз в ${months} ${word}`;
  }
  return `на ${days} дней`;
}

function coverPublicUrl(path: string | null): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from("memberships-media").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

type ActiveMembership = {
  id: string;
  ends_at: string | null;
  visits_left: number | null;
  auto_renew: boolean | null;
  memberships:
    | {
        name: string;
        description: string | null;
        benefits: string[] | null;
        visits_count: number | null;
        duration_days: number | null;
        price: number | null;
      }
    | null;
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
  const [activeTab, setActiveTab] = useState<"unlimited" | "packages" | "couples">("unlimited");
  const [purchasing, setPurchasing] = useState(false);
  const [activeOpen, setActiveOpen] = useState(false);
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);
  const [confirmCancelRenewOpen, setConfirmCancelRenewOpen] = useState(false);
  const [cancellingRenew, setCancellingRenew] = useState(false);

  const unlimitedTopRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const unlimitedBottomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const packagesTopRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const packagesBottomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const couplesTopRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const couplesBottomRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [unlimitedTopHeight, setUnlimitedTopHeight] = useState(0);
  const [unlimitedBottomHeight, setUnlimitedBottomHeight] = useState(0);
  const [packagesTopHeight, setPackagesTopHeight] = useState(0);
  const [packagesBottomHeight, setPackagesBottomHeight] = useState(0);
  const [couplesTopHeight, setCouplesTopHeight] = useState(0);
  const [couplesBottomHeight, setCouplesBottomHeight] = useState(0);

  const unlimitedMemberships = useMemo(
    () => memberships.filter((m) => m.visits_count === null && !m.for_couple),
    [memberships]
  );
  const packagesMemberships = useMemo(
    () => memberships.filter((m) => m.visits_count !== null && !m.for_couple),
    [memberships]
  );
  const couplesMemberships = useMemo(
    () => memberships.filter((m) => m.for_couple === true),
    [memberships]
  );

  function measureGroup(
    topRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    bottomRefs: React.MutableRefObject<Map<string, HTMLDivElement>>,
    setTop: (h: number) => void,
    setBottom: (h: number) => void
  ) {
    let maxTop = 0;
    topRefs.current.forEach((el) => {
      maxTop = Math.max(maxTop, el.getBoundingClientRect().height);
    });
    let maxBottom = 0;
    bottomRefs.current.forEach((el) => {
      maxBottom = Math.max(maxBottom, el.getBoundingClientRect().height);
    });
    setTop(maxTop);
    setBottom(maxBottom);
  }

  useLayoutEffect(() => {
    if (unlimitedMemberships.length > 0) {
      measureGroup(
        unlimitedTopRefs,
        unlimitedBottomRefs,
        setUnlimitedTopHeight,
        setUnlimitedBottomHeight
      );
    }
  }, [unlimitedMemberships]);

  useLayoutEffect(() => {
    if (packagesMemberships.length > 0) {
      measureGroup(
        packagesTopRefs,
        packagesBottomRefs,
        setPackagesTopHeight,
        setPackagesBottomHeight
      );
    }
  }, [packagesMemberships]);

  useLayoutEffect(() => {
    if (couplesMemberships.length > 0) {
      measureGroup(
        couplesTopRefs,
        couplesBottomRefs,
        setCouplesTopHeight,
        setCouplesBottomHeight
      );
    }
  }, [couplesMemberships]);


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
          "id, name, description, benefits, visits_count, duration_days, price, installment_enabled, studio_id, cover_url, for_couple";
        const [{ data: m, error: mErr }, { data: act, error: aErr }] = await Promise.all([
          db
            .from("memberships")
            .select(membershipSelect)
            .eq("studio_id", c.studio_id)
            .eq("is_active", true)
            .order("price", { ascending: true }),
          db
            .from("client_memberships")
            .select(
              "id, ends_at, visits_left, auto_renew, memberships(name, description, benefits, visits_count, duration_days, price)"
            )
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
            .eq("is_active", true)
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

  const refreshActive = async () => {
    if (!client) return;
    const { data: act } = await db
      .from("client_memberships")
      .select(
        "id, ends_at, visits_left, auto_renew, memberships(name, description, benefits, visits_count, duration_days, price)"
      )
      .eq("client_id", client.id)
      .eq("status", "active")
      .maybeSingle();
    setActive((act as ActiveMembership) ?? null);
  };

  

  const handlePurchase = async () => {
    if (!selected || !client) return;
    // If user has active membership and is picking a different one → require confirmation first
    if (active && !confirmSwitchOpen) {
      setConfirmSwitchOpen(true);
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

      await refreshActive();

      toast.success(
        active
          ? `Вы перешли на «${selected.name}»`
          : `Абонемент «${selected.name}» оформлен!`
      );
      setSelected(null);
      setConfirmSwitchOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось оформить абонемент");
    } finally {
      setPurchasing(false);
    }
  };

  const handleCancelAutorenew = async () => {
    if (!active) return;
    setCancellingRenew(true);
    try {
      const { error: rpcErr } = await (supabase as any).rpc("cancel_membership_autorenew", {
        _client_membership_id: active.id,
        _source: "mobile",
      });
      if (rpcErr) throw rpcErr;
      await refreshActive();
      toast.success("Автопродление отключено");
      setConfirmCancelRenewOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось отключить автопродление");
    } finally {
      setCancellingRenew(false);
    }
  };

  return (
    <PageShell
      scrollKey={activeTab}
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Абонементы</h1>
          <p className="text-sm text-white/70">Выберите подходящий пакет занятий</p>
          {!loading && user && active && (() => {
            const autoOn = active.auto_renew !== false;
            const accent = autoOn ? "#22C55E" : "#EF4444";
            return (
              <Card
                onClick={() => setActiveOpen(true)}
                className="mt-4 p-0 overflow-hidden cursor-pointer transition-colors hover:bg-card/90 active:bg-card/80 border-0"
              >
                <div className="flex items-stretch">
                  <div className="flex-1 p-4 border border-border rounded-l-xl bg-white">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-14 w-14 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${accent}26` }}
                      >
                        {autoOn ? (
                          <ShieldCheck className="h-8 w-8" style={{ color: accent }} />
                        ) : (
                          <CloseCircle className="h-8 w-8" style={{ color: accent }} weight="BoldDuotone" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-semibold text-foreground truncate">
                          {active.memberships?.name ?? "Абонемент"}
                        </div>
                        {active.ends_at && (
                          <div className="text-sm text-muted-foreground mt-0.5">
                            Действует до{" "}
                            {new Date(active.ends_at).toLocaleDateString("ru-RU", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          </div>
                        )}
                        <div className="text-sm mt-0.5" style={{ color: accent }}>
                          {autoOn ? "Автопродление включено" : "Автопродление выключено"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="w-6 flex items-center justify-center bg-muted">
                    <ChevronRight className="h-5 w-5 text-[#66676D]" />
                  </div>
                </div>
              </Card>
            );
          })()}
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

        {!loading && user && !error && memberships.length === 0 && !active && (
          <Card className="p-4 text-sm text-muted-foreground">
            Пока нет доступных абонементов.
          </Card>
        )}

        {!loading && user && !error && memberships.length > 0 && (
          <div className="w-full">
            <div data-memberships-tabs className="-mx-4 px-4 flex gap-6 overflow-x-auto no-scrollbar mb-4">
              {[
                { key: "unlimited", label: "Безлимитные" },
                { key: "packages", label: "Пакеты тренировок" },
                { key: "couples", label: "Для двоих" },
              ].map((t) => {
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => {
                      setActiveTab(t.key as "unlimited" | "packages" | "couples");
                    }}
                    className={`shrink-0 relative pt-3 pb-1 text-base font-semibold transition-colors ${
                      active ? "text-foreground" : "text-[#66676D]"
                    }`}
                  >
                    {t.label}
                    {active && (
                      <span className="absolute left-0 right-0 -bottom-px h-1 bg-[#FFE500] rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === "unlimited" && (
              <>
                {unlimitedMemberships.length > 0 ? (
                  <div className="-mx-4 px-4 scroll-pl-4 scroll-pr-4 flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2">
                    {unlimitedMemberships.map((m, idx) => (
                      <MembershipCard
                        key={m.id}
                        membership={m}
                        color={COLORS[idx % COLORS.length]}
                        onSelect={() => setSelected({ ...m })}
                        topMinHeight={unlimitedTopHeight || undefined}
                        bottomMinHeight={unlimitedBottomHeight || undefined}
                        onTopRef={(el) => {
                          if (el) unlimitedTopRefs.current.set(m.id, el);
                          else unlimitedTopRefs.current.delete(m.id);
                        }}
                        onBottomRef={(el) => {
                          if (el) unlimitedBottomRefs.current.set(m.id, el);
                          else unlimitedBottomRefs.current.delete(m.id);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="p-4 text-sm text-muted-foreground">Пока нет доступных безлимитных абонементов.</Card>
                )}
              </>
            )}

            {activeTab === "packages" && (
              <>
                {packagesMemberships.length > 0 ? (
                  <div className="-mx-4 px-4 scroll-pl-4 scroll-pr-4 flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2">
                    {packagesMemberships.map((m, idx) => (
                      <MembershipCard
                        key={m.id}
                        membership={m}
                        color={COLORS[idx % COLORS.length]}
                        onSelect={() => setSelected({ ...m })}
                        topMinHeight={packagesTopHeight || undefined}
                        bottomMinHeight={packagesBottomHeight || undefined}
                        onTopRef={(el) => {
                          if (el) packagesTopRefs.current.set(m.id, el);
                          else packagesTopRefs.current.delete(m.id);
                        }}
                        onBottomRef={(el) => {
                          if (el) packagesBottomRefs.current.set(m.id, el);
                          else packagesBottomRefs.current.delete(m.id);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="p-4 text-sm text-muted-foreground">Пока нет доступных пакетов тренировок.</Card>
                )}
              </>
            )}

            {activeTab === "couples" && (
              <>
                {couplesMemberships.length > 0 ? (
                  <div className="-mx-4 px-4 scroll-pl-4 scroll-pr-4 flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2">
                    {couplesMemberships.map((m, idx) => (
                      <MembershipCard
                        key={m.id}
                        membership={m}
                        color={COLORS[idx % COLORS.length]}
                        onSelect={() => setSelected({ ...m })}
                        topMinHeight={couplesTopHeight || undefined}
                        bottomMinHeight={couplesBottomHeight || undefined}
                        onTopRef={(el) => {
                          if (el) couplesTopRefs.current.set(m.id, el);
                          else couplesTopRefs.current.delete(m.id);
                        }}
                        onBottomRef={(el) => {
                          if (el) couplesBottomRefs.current.set(m.id, el);
                          else couplesBottomRefs.current.delete(m.id);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="p-4 text-sm text-muted-foreground">Пока нет доступных абонементов для двоих.</Card>
                )}
              </>
            )}
          </div>
        )}
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
          hasActive={!!active}
        />
      )}

      {active && (
        <ActiveMembershipDrawer
          active={active}
          open={activeOpen}
          onOpenChange={setActiveOpen}
          onCancelAutorenew={() => setConfirmCancelRenewOpen(true)}
        />
      )}

      <AlertDialog open={confirmSwitchOpen} onOpenChange={setConfirmSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перейти на этот абонемент?</AlertDialogTitle>
            <AlertDialogDescription>
              У вас уже есть активный абонемент. При переходе текущий абонемент будет аннулирован,
              а вместо него подключится выбранный.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purchasing}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={purchasing}
              onClick={(e) => {
                e.preventDefault();
                handlePurchase();
              }}
            >
              {purchasing ? "Переходим…" : "Перейти"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancelRenewOpen} onOpenChange={setConfirmCancelRenewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить автопродление?</AlertDialogTitle>
            <AlertDialogDescription>
              Абонемент действует до конца оплаченного периода. После этой даты он закончится,
              и вы не сможете посещать клуб, пока не оформите новый.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancellingRenew}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancellingRenew}
              onClick={(e) => {
                e.preventDefault();
                handleCancelAutorenew();
              }}
            >
              {cancellingRenew ? "Отключаем…" : "Отключить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function MembershipCard({
  membership,
  color,
  onSelect,
  topMinHeight,
  bottomMinHeight,
  onTopRef,
  onBottomRef,
}: {
  membership: Membership;
  color: string;
  onSelect: () => void;
  topMinHeight?: number;
  bottomMinHeight?: number;
  onTopRef?: (el: HTMLDivElement | null) => void;
  onBottomRef?: (el: HTMLDivElement | null) => void;
}) {
  const cover = coverPublicUrl(membership.cover_url);
  const features = [
    membership.visits_count === null
      ? "Безлимит посещений"
      : `${membership.visits_count} занятий`,
    `Срок действия ${membership.duration_days} дней`,
    ...((membership.benefits ?? []).filter(Boolean) as string[]),
  ];

  return (
    <Card className="shrink-0 w-[85%] snap-start overflow-hidden rounded-xl p-0 flex flex-col">
      {/* Top: cover (image fills area; no overlay when image present) */}
      <div
        className="relative p-5 flex flex-col"
        style={
          cover
            ? {
                backgroundImage: `url(${cover})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div ref={onTopRef} style={{ minHeight: topMinHeight }}>
          <h3 className="text-xl font-bold leading-tight">{membership.name}</h3>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-black italic tracking-tight">
              {Number(membership.price).toLocaleString("ru-RU")} ₾
            </span>
            <span className="text-sm text-muted-foreground">{formatPeriod(membership.duration_days)}</span>
          </div>
          {membership.description && (
            <p className="mt-3 text-sm text-muted-foreground">{membership.description}</p>
          )}
        </div>
        <Button
          onClick={onSelect}
          className="mt-5 w-full h-12 rounded-full bg-[#FFE500] text-[#1B1C1F] font-bold text-base hover:bg-[#FFE500]/90 active:scale-[0.99] transition"
        >
          Выбрать
        </Button>
      </div>

      {/* Bottom: features */}
      <div ref={onBottomRef} className="p-5 border-t border-card-border" style={{ minHeight: bottomMinHeight }}>
        <div className="text-xs font-bold tracking-wider text-muted-foreground mb-3">
          ПРЕИМУЩЕСТВА
        </div>
        <div className="space-y-2">
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle
                className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5"
                weight="BoldDuotone"
              />
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function MembershipDrawer({
  membership,
  color,
  open,
  onOpenChange,
  onPurchase,
  purchasing,
  hasActive,
}: {
  membership: Membership;
  color: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: () => void;
  purchasing: boolean;
  hasActive: boolean;
}) {
  const features = [
    membership.visits_count === null
      ? "Безлимит посещений"
      : `${membership.visits_count} занятий`,
    `Срок действия ${membership.duration_days} дней`,
    ...((membership.benefits ?? []).filter(Boolean) as string[]),
  ];

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DrawerPrimitive.Title className="text-2xl font-bold leading-tight">
                  {membership.name}
                </DrawerPrimitive.Title>
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
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" weight="BoldDuotone" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm">
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                {hasActive
                  ? "Текущий абонемент будет аннулирован, новый подключится сразу"
                  : "Абонемент активируется автоматически после оформления"}
              </span>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Стоимость</div>
                <div className="text-2xl font-black italic">
                  {Number(membership.price).toLocaleString("ru-RU")} ₾
                </div>
              </div>
            </div>

            <Button
              onClick={onPurchase}
              disabled={purchasing}
              className="mt-4 w-full h-14 rounded-full bg-[#FFE500] text-[#1B1C1F] font-bold text-base hover:bg-[#FFE500]/90 active:scale-[0.99] transition disabled:opacity-60"
            >
              {purchasing
                ? hasActive
                  ? "Переходим…"
                  : "Оформляем…"
                : hasActive
                  ? "Перейти на этот абонемент"
                  : "Приобрести"}
            </Button>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}

function ActiveMembershipDrawer({
  active,
  open,
  onOpenChange,
  onCancelAutorenew,
}: {
  active: ActiveMembership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelAutorenew: () => void;
}) {
  const m = active.memberships;
  const autoOn = active.auto_renew !== false;
  const features = [
    m?.visits_count == null
      ? "Безлимит посещений"
      : `${m.visits_count} занятий`,
    m?.duration_days ? `Срок действия ${m.duration_days} дней` : null,
    ...((m?.benefits ?? []).filter(Boolean) as string[]),
  ].filter(Boolean) as string[];

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DrawerPrimitive.Title className="text-2xl font-bold leading-tight">
                  {m?.name ?? "Ваш абонемент"}
                </DrawerPrimitive.Title>
                {m?.description && (
                  <p className="text-sm text-muted-foreground mt-1">{m.description}</p>
                )}
              </div>
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: (autoOn ? "#22C55E" : "#EF4444") + "26" }}
              >
                {autoOn ? (
                  <ShieldCheck className="h-7 w-7" style={{ color: "#22C55E" }} />
                ) : (
                  <CloseCircle className="h-7 w-7" style={{ color: "#EF4444" }} weight="BoldDuotone" />
                )}
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" weight="BoldDuotone" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div
              className="mt-5 flex items-center gap-2 rounded-xl p-3 text-sm"
              style={{ backgroundColor: (autoOn ? "#22C55E" : "#EF4444") + "14" }}
            >
              {autoOn ? (
                <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "#22C55E" }} />
              ) : (
                <CloseCircle className="h-4 w-4 shrink-0" style={{ color: "#EF4444" }} weight="BoldDuotone" />
              )}
              <span style={{ color: autoOn ? "#15803D" : "#B91C1C" }}>
                {autoOn
                  ? active.ends_at
                    ? `Автопродление включено. Следующее списание ${new Date(active.ends_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`
                    : "Автопродление включено"
                  : active.ends_at
                    ? `Автопродление выключено. Абонемент закончится ${new Date(active.ends_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`
                    : "Автопродление выключено"}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <Button
                onClick={() => onOpenChange(false)}
                variant="secondary"
                className="flex-1 h-14 rounded-full font-semibold text-base"
              >
                Выйти
              </Button>
              <Button
                onClick={onCancelAutorenew}
                disabled={!autoOn}
                className="flex-1 h-14 rounded-full bg-[#EF4444] text-white font-bold text-base hover:bg-[#EF4444]/90 active:scale-[0.99] transition disabled:opacity-50"
              >
                Отменить автопродление
              </Button>
            </div>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
