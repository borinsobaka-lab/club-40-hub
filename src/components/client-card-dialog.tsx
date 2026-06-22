import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditActiveMembershipDialog } from "@/components/edit-active-membership-dialog";

type MemberProfile = {
  user_id: string;
  primary_goal: string | null;
  goal_motivation: string | null;
  target_timeframe: string | null;
  desired_frequency: number | null;
  experience_level: string | null;
  current_weekly_activity: number | null;
  tried_group_hiit: boolean | null;
  health_flags: string[] | null;
  health_notes: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  gender: string | null;
  preferred_times: string[] | null;
  referral_source: string | null;
  onboarding_completed_at: string | null;
  updated_at: string | null;
};

const GOAL_LABELS: Record<string, string> = {
  weight_loss: "Снизить вес",
  muscle_strength: "Сила / мышцы",
  endurance: "Выносливость и форма",
  energy_wellbeing: "Энергия и самочувствие",
  stress_habit: "Снять стресс, привычка",
  event_prep: "Подготовка к событию",
};
const EXPERIENCE_LABELS: Record<string, string> = {
  beginner: "Новичок / большой перерыв",
  occasional: "Время от времени",
  regular: "Регулярно, 2–3 раза в неделю",
  advanced: "Опытный, интенсивно",
};
const TIMEFRAME_LABELS: Record<string, string> = {
  no_rush: "Без спешки",
  few_months: "1–3 месяца",
  event_date: "К конкретной дате",
};
const ACTIVITY_LABELS: Record<number, string> = {
  0: "Почти не двигаюсь",
  1: "1 раз в неделю",
  3: "2–3 раза в неделю",
  5: "4+ раз в неделю",
};
const HEALTH_LABELS: Record<string, string> = {
  back_joints: "Спина / суставы",
  cardio_pressure: "Сердце / давление",
  recent_injury: "Недавняя травма или операция",
  pregnancy: "Беременность",
  chronic: "Хроническое заболевание",
  none: "Ничего из перечисленного",
};
const TIME_LABELS: Record<string, string> = {
  morning: "Утро",
  day: "День",
  evening: "Вечер",
};
const REFERRAL_LABELS: Record<string, string> = {
  instagram: "Instagram / соцсети",
  referral: "Рекомендация друга",
  walk_by: "Проходил(а) мимо",
  search: "Поиск / карты",
  other: "Другое",
};
const PROFILE_GENDER: Record<string, string> = {
  female: "Женский",
  male: "Мужской",
  other: "Другое",
};

type ClientLike = {
  id: string;
  user_id?: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
  avatar_url: string | null;
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function displayName(c: Pick<ClientLike, "first_name" | "last_name" | "full_name">) {
  return [c.last_name, c.first_name].filter(Boolean).join(" ").trim() || c.full_name || "—";
}

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ru-RU");
  } catch {
    return v;
  }
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
}

function genderLabel(g: string | null) {
  if (g === "male") return "Мужской";
  if (g === "female") return "Женский";
  return "—";
}

function sourceLabel(s: string | null | undefined) {
  return s === "mobile" ? "Приложение" : "Портал";
}

type SaleRow = {
  id: string;
  sold_at: string;
  total_amount: number;
  down_payment_amount: number;
  remaining_installments: number;
  source: "admin" | "mobile" | null;
  admin_name: string | null;
  comment: string | null;
  memberships: { name: string } | { name: string }[] | null;
};

type ActiveCM = {
  id: string;
  source: "admin" | "mobile";
  started_at: string;
  ends_at: string | null;
  visits_left: number | null;
  memberships: { name: string } | { name: string }[] | null;
};

function membershipName(m: ActiveCM["memberships"] | SaleRow["memberships"]) {
  if (!m) return "—";
  if (Array.isArray(m)) return m[0]?.name ?? "—";
  return m.name;
}

export function ClientCardDialog({
  open,
  onOpenChange,
  client,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: ClientLike | null;
  onEdit?: (c: ClientLike) => void;
}) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [active, setActive] = useState<ActiveCM | null>(null);
  const [loadingActive, setLoadingActive] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const load = () => {
    if (!client?.id) return;
    setLoadingSales(true);
    supabase
      .from("sales")
      .select("id, sold_at, total_amount, down_payment_amount, remaining_installments, source, admin_name, comment, memberships(name)")
      .eq("client_id", client.id)
      .order("sold_at", { ascending: false })
      .then(({ data, error }) => {
        setLoadingSales(false);
        if (!error) setSales((data as unknown as SaleRow[]) ?? []);
      });
    setLoadingActive(true);
    supabase
      .from("client_memberships")
      .select("id, source, started_at, ends_at, visits_left, memberships(name)")
      .eq("client_id", client.id)
      .eq("status", "active")
      .maybeSingle()
      .then(({ data }) => {
        setLoadingActive(false);
        setActive((data as unknown as ActiveCM | null) ?? null);
      });
    if (client.user_id) {
      setLoadingProfile(true);
      (supabase as unknown as { from: (t: string) => any })
        .from("member_profiles")
        .select("*")
        .eq("user_id", client.user_id)
        .maybeSingle()
        .then(({ data }: { data: MemberProfile | null }) => {
          setLoadingProfile(false);
          setProfile(data ?? null);
        });
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    if (!open || !client?.id) {
      setSales([]);
      setActive(null);
      setProfile(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  if (!client) return null;
  const name = displayName(client);
  const photo = client.avatar_url || client.photo_url || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Карточка клиента {name}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20">
              {photo && <AvatarImage src={photo} alt={name} />}
              <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="text-xl font-semibold">{name}</div>
              <div className="text-sm text-muted-foreground">
                {client.phone || "—"} {client.email ? `· ${client.email}` : ""}
              </div>
              {client.crm_link && (
                <a
                  href={client.crm_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть в CRM
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <Field label="Пол" value={genderLabel(client.gender)} />
            <Field label="Дата рождения" value={formatDate(client.birthday)} />
            <Field label="Регистрация" value={formatDate(client.registration_date)} />
            <Field label="Последний визит" value={formatDate(client.last_visit_date)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase text-muted-foreground">Активный абонемент</div>
              {active && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Редактировать
                </Button>
              )}
            </div>
            {loadingActive ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !active ? (
              <div className="rounded-lg border bg-background p-4 text-center text-sm text-muted-foreground">
                Нет активного абонемента.
              </div>
            ) : (
              <div className="rounded-lg border bg-background p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{membershipName(active.memberships)}</div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {sourceLabel(active.source)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(active.started_at)} → {active.ends_at ? formatDate(active.ends_at) : "бессрочно"}
                  {" · "}
                  {active.visits_left == null ? "посещения: безлимит" : `осталось посещений: ${active.visits_left}`}
                </div>
              </div>
            )}
          </div>

          {client.notes && (
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Заметки</div>
              <div className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm">
                {client.notes}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs uppercase text-muted-foreground">История продаж</div>
            {loadingSales ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sales.length === 0 ? (
              <div className="rounded-lg border bg-background p-4 text-center text-sm text-muted-foreground">
                Продаж пока нет.
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-background">
                {sales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {membershipName(s.memberships)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(s.sold_at)}
                        {" · "}{sourceLabel(s.source)}
                        {s.admin_name ? ` · ${s.admin_name}` : ""}
                        {s.remaining_installments > 0
                          ? ` · рассрочка 1 + ${s.remaining_installments}, первый взнос ${formatMoney(Number(s.down_payment_amount))}`
                          : ""}
                      </div>
                    </div>
                    <div className="shrink-0 font-medium">{formatMoney(Number(s.total_amount))}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          {onEdit && (
            <Button variant="outline" onClick={() => onEdit(client)}>
              <Pencil className="mr-1 h-4 w-4" />
              Редактировать
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
        </DialogFooter>

        <EditActiveMembershipDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          membership={active ? { id: active.id, ends_at: active.ends_at, visits_left: active.visits_left } : null}
          onSaved={load}
        />
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
