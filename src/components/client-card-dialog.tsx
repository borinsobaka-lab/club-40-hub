import type React from "react";
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
import { Badge } from "@/components/ui/badge";
import { EditActiveMembershipDialog } from "@/components/edit-active-membership-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import { MembershipStatusBadge, AutoRenewBadge, effectiveStatus } from "@/components/membership-status-badge";
import { computeClubStatus, type ClubStatus, type MembershipLite } from "@/lib/client-status";

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
    currency: "GEL",
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
  client_memberships:
    | {
        id: string;
        status: string;
        auto_renew: boolean | null;
        ends_at: string | null;
        cancelled_at: string | null;
      }[]
    | null;
};

type ActiveCM = {
  id: string;
  source: "admin" | "mobile";
  started_at: string;
  ends_at: string | null;
  visits_left: number | null;
  auto_renew: boolean | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  memberships: { name: string } | { name: string }[] | null;
};

type ActiveCMWithStatus = ActiveCM & { status: string };

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
  const [active, setActive] = useState<ActiveCMWithStatus | null>(null);
  const [loadingActive, setLoadingActive] = useState(false);
  const [allMemberships, setAllMemberships] = useState<MembershipLite[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const load = () => {
    if (!client?.id) return;
    setLoadingSales(true);
    supabase
      .from("sales")
      .select("id, sold_at, total_amount, down_payment_amount, remaining_installments, source, admin_name, comment, memberships(name), client_memberships(id, status, auto_renew, ends_at, cancelled_at)")
      .eq("client_id", client.id)
      .order("sold_at", { ascending: false })
      .then(({ data, error }) => {
        setLoadingSales(false);
        if (!error) setSales((data as unknown as SaleRow[]) ?? []);
      });
    setLoadingActive(true);
    supabase
      .from("client_memberships")
      .select("id, status, source, started_at, ends_at, visits_left, auto_renew, cancelled_at, cancel_reason, memberships(name)")
      .eq("client_id", client.id)
      .order("started_at", { ascending: false })
      .then(({ data }) => {
        setLoadingActive(false);
        const rows = (data as unknown as (ActiveCM & { status: string })[]) ?? [];
        setAllMemberships(
          rows.map((r) => ({ client_id: client.id, status: r.status, ends_at: r.ends_at })),
        );
        const today = new Date().toISOString().slice(0, 10);
        const a =
          rows.find(
            (r) => r.status === "active" && (!r.ends_at || r.ends_at >= today),
          ) ?? null;
        setActive(a);
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
      setAllMemberships([]);
      setProfile(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  if (!client) return null;
  const name = displayName(client);
  const photo = client.avatar_url || client.photo_url || "";
  const clubStatus: ClubStatus = computeClubStatus(allMemberships);

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
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xl font-semibold">{name}</div>
                <ClubStatusBadge status={clubStatus} withFull />
              </div>
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

          <Tabs defaultValue="card" className="w-full">
            <TabsList>
              <TabsTrigger value="card">Карточка</TabsTrigger>
              <TabsTrigger value="visits">Посещения</TabsTrigger>
              <TabsTrigger value="profile">Анкета</TabsTrigger>
            </TabsList>


            <TabsContent value="card" className="mt-4 space-y-5">
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
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <MembershipStatusBadge m={active} />
                      <AutoRenewBadge on={active.auto_renew} />
                    </div>
                    {active.cancelled_at && (
                      <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                        Отменён: {formatDate(active.cancelled_at)}
                        {active.cancel_reason ? ` · ${active.cancel_reason}` : ""}
                      </div>
                    )}
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
            </TabsContent>

            <TabsContent value="visits" className="mt-4">
              <VisitsTab open={open} userId={client.user_id ?? null} />
            </TabsContent>

            <TabsContent value="profile" className="mt-4">

              <ProfileTab
                profile={profile}
                loading={loadingProfile}
                hasUser={!!client.user_id}
              />
            </TabsContent>
          </Tabs>
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

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}

function ProfileTab({
  profile,
  loading,
  hasUser,
}: {
  profile: MemberProfile | null;
  loading: boolean;
  hasUser: boolean;
}) {
  if (!hasUser) {
    return (
      <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        Клиент ещё не зарегистрирован в мобильном приложении — анкета появится после регистрации и прохождения онбординга.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        Клиент пока не прошёл онбординг.
      </div>
    );
  }

  const goal = profile.primary_goal ? GOAL_LABELS[profile.primary_goal] ?? profile.primary_goal : null;
  const exp = profile.experience_level ? EXPERIENCE_LABELS[profile.experience_level] ?? profile.experience_level : null;
  const tf = profile.target_timeframe ? TIMEFRAME_LABELS[profile.target_timeframe] ?? profile.target_timeframe : null;
  const act = profile.current_weekly_activity != null ? ACTIVITY_LABELS[profile.current_weekly_activity] ?? String(profile.current_weekly_activity) : null;
  const hiit = profile.tried_group_hiit == null ? null : profile.tried_group_hiit ? "Да, формат знаком" : "Нет, будет впервые";
  const flags = (profile.health_flags ?? []).map((f) => HEALTH_LABELS[f] ?? f).join(", ") || null;
  const times = (profile.preferred_times ?? []).map((t) => TIME_LABELS[t] ?? t).join(", ") || null;
  const gender = profile.gender ? PROFILE_GENDER[profile.gender] ?? profile.gender : null;
  const ref = profile.referral_source ? REFERRAL_LABELS[profile.referral_source] ?? profile.referral_source : null;
  const freq = profile.desired_frequency
    ? profile.desired_frequency >= 4
      ? "4+ раз в неделю"
      : `${profile.desired_frequency} раз в неделю`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {profile.onboarding_completed_at
            ? `Онбординг пройден ${new Date(profile.onboarding_completed_at).toLocaleDateString("ru-RU")}`
            : "Онбординг не завершён — данные неполные"}
        </span>
        {profile.updated_at && (
          <span>обновлено {new Date(profile.updated_at).toLocaleDateString("ru-RU")}</span>
        )}
      </div>

      <Section title="Цели и мотивация">
        <ProfileRow label="Главная цель" value={goal} />
        <ProfileRow label="Что подтолкнуло" value={profile.goal_motivation} />
        <ProfileRow label="Срок" value={tf} />
        <ProfileRow label="Желаемая частота" value={freq} />
      </Section>

      <Section title="Опыт и нагрузка">
        <ProfileRow label="Опыт тренировок" value={exp} />
        <ProfileRow label="Текущая активность" value={act} />
        <ProfileRow label="Групповой формат (HIIT)" value={hiit} />
        <ProfileRow label="Здоровье" value={flags} />
        <ProfileRow label="Комментарий по здоровью" value={profile.health_notes} />
      </Section>

      <Section title="Базовые параметры">
        <div className="grid grid-cols-2 gap-x-6">
          <ProfileRow label="Рост" value={profile.height_cm ? `${profile.height_cm} см` : null} />
          <ProfileRow label="Вес" value={profile.weight_kg ? `${profile.weight_kg} кг` : null} />
          <ProfileRow label="Год рождения" value={profile.birth_year} />
          <ProfileRow label="Пол" value={gender} />
        </div>
      </Section>

      <Section title="Логистика и маркетинг">
        <ProfileRow label="Удобное время" value={times} />
        <ProfileRow label="Откуда узнал(а)" value={ref} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

type VisitRow = {
  id: string;
  workout_name: string | null;
  starts_at: string;
  status: "booked" | "completed" | "cancelled" | "attended" | "no_show" | "rejected";
  cancelled_at: string | null;
};

const VISIT_STATUS_LABEL: Record<VisitRow["status"], string> = {
  booked: "Забронировано",
  attended: "Посещено",
  no_show: "Пропущено",
  cancelled: "Отменено",
  rejected: "Отклонена",
  completed: "Проведено",
};

function visitStatusBadge(v: VisitRow["status"]) {
  if (v === "attended" || v === "completed") return <Badge variant="default">{VISIT_STATUS_LABEL[v]}</Badge>;
  if (v === "cancelled") return <Badge variant="destructive">{VISIT_STATUS_LABEL[v]}</Badge>;
  if (v === "rejected")
    return (
      <Badge
        variant="outline"
        className="text-orange-600 border-orange-600 dark:text-orange-400 dark:border-orange-400"
      >
        {VISIT_STATUS_LABEL[v]}
      </Badge>
    );
  if (v === "no_show") return <Badge variant="outline">{VISIT_STATUS_LABEL[v]}</Badge>;
  return <Badge variant="secondary">{VISIT_STATUS_LABEL[v]}</Badge>;
}

function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function VisitsTab({ open, userId }: { open: boolean; userId: string | null }) {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) {
      setRows([]);
      return;
    }
    setLoading(true);
    supabase
      .from("bookings_log")
      .select("id, workout_name, starts_at, status, cancelled_at")
      .eq("user_id", userId)
      .order("starts_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setLoading(false);
        setRows((data as unknown as VisitRow[]) ?? []);
      });
  }, [open, userId]);

  if (!userId) {
    return (
      <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        Клиент ещё не зарегистрирован в мобильном приложении — посещений нет.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        Посещений пока нет.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Тренировка</th>
            <th className="px-3 py-2 text-left font-medium">Дата и время</th>
            <th className="px-3 py-2 text-left font-medium">Статус</th>
            <th className="px-3 py-2 text-left font-medium">Отменена</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2">{r.workout_name ?? "—"}</td>
              <td className="px-3 py-2">{fmtDateTime(r.starts_at)}</td>
              <td className="px-3 py-2">{visitStatusBadge(r.status)}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {fmtDateTime(r.cancelled_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
