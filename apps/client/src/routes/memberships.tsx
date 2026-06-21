import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Ticket, Clock, Dumbbell, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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
  description: string;
  price: number;
  visits: number | null;
  durationDays: number;
  features: string[];
  color: string;
};

const MOCK_MEMBERSHIPS: Membership[] = [
  {
    id: "basic",
    name: "Базовый",
    description: "Отличный старт для знакомства с клубом",
    price: 4000,
    visits: 4,
    durationDays: 30,
    features: ["4 занятия", "Срок действия 30 дней", "Все типы тренировок"],
    color: "#0ea5e9",
  },
  {
    id: "standard",
    name: "Стандартный",
    description: "Оптимальный баланс цены и количества занятий",
    price: 7000,
    visits: 8,
    durationDays: 30,
    features: ["8 занятий", "Срок действия 30 дней", "Все типы тренировок", "Приоритетное бронирование"],
    color: "#8b5cf6",
  },
  {
    id: "premium",
    name: "Премиум",
    description: "Максимум возможностей для прогресса",
    price: 9000,
    visits: 12,
    durationDays: 30,
    features: ["12 занятий", "Срок действия 30 дней", "Все типы тренировок", "Приоритетное бронирование", "Гостевой визит"],
    color: "#f43f5e",
  },
  {
    id: "unlimited",
    name: "Безлимитный",
    description: "Тренируйтесь без ограничений",
    price: 15000,
    visits: null,
    durationDays: 30,
    features: ["Безлимит посещений", "Срок действия 30 дней", "Все типы тренировок", "Приоритетное бронирование", "2 гостевых визита"],
    color: "#10b981",
  },
];

function MembershipsPage() {
  const [selected, setSelected] = useState<Membership | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const handlePurchase = () => {
    setPurchasing(true);
    setTimeout(() => {
      setPurchasing(false);
      toast.success(`Абонемент «${selected?.name}» оформлен!`);
      setSelected(null);
    }, 1500);
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
        {MOCK_MEMBERSHIPS.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m)}
            className="w-full text-left"
          >
            <Card className="p-4 relative overflow-hidden border-0 shadow-md active:scale-[0.99] transition-transform">
              <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ backgroundColor: m.color }}
              />
              <div className="flex items-start justify-between gap-3 pl-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold">{m.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{m.description}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    {m.visits !== null ? (
                      <span className="inline-flex items-center gap-1">
                        <Dumbbell className="h-3.5 w-3.5" />
                        {m.visits} занятий
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Dumbbell className="h-3.5 w-3.5" />
                        Безлимит
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {m.durationDays} дней
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-black">{m.price.toLocaleString("ru-RU")}₽</div>
                </div>
              </div>
            </Card>
          </button>
        ))}
      </div>

      {/* Drawer для деталей абонемента */}
      {selected && (
        <MembershipDrawer
          membership={selected}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onPurchase={handlePurchase}
          purchasing={purchasing}
        />
      )}
    </PageShell>
  );
}

function MembershipDrawer({
  membership,
  open,
  onOpenChange,
  onPurchase,
  purchasing,
}: {
  membership: Membership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: () => void;
  purchasing: boolean;
}) {
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
              <p className="text-sm text-muted-foreground mt-1">{membership.description}</p>
            </div>
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: membership.color + "20" }}
            >
              <Ticket className="h-7 w-7" style={{ color: membership.color }} />
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {membership.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              Абонемент активируется с момента первого посещения
            </span>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Стоимость</div>
              <div className="text-2xl font-black">{membership.price.toLocaleString("ru-RU")}₽</div>
            </div>
          </div>

          <Button
            onClick={onPurchase}
            disabled={purchasing}
            className="mt-4 w-full h-14 rounded-2xl bg-[#FFE500] text-[#1B1C1F] font-bold text-base hover:bg-[#FFE500]/90 active:scale-[0.99] transition disabled:opacity-60"
          >
            {purchasing ? "Оформляем…" : "Приобрести"}
          </Button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}
