import type React from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditActiveMembershipDialog } from "@/components/edit-active-membership-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import {
  MembershipStatusBadge,
  AutoRenewBadge,
  effectiveStatus,
} from "@/components/membership-status-badge";
import { computeClubStatus } from "@/lib/client-status";
import type { BookingStatus } from "@/lib/bookings";
import {
  clientName,
  formatDate,
  formatDateTime,
  formatMoney,
  genderLabel,
  initials,
  todayISO,
} from "@/lib/format";
import { saleSourceLabel } from "@/lib/payments";
import { unwrap } from "@/lib/query";

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

/** Поля клиента, которые нужны карточке (строка clients или clients_with_status). */
export type ClientLike = {
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
};

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

type MembershipRef = { name: string; freeze_days_allowed?: number | null };

type MembershipRow = {
  id: string;
  status: string;
  source: "admin" | "mobile";
  started_at: string;
  ends_at: string | null;
  visits_left: number | null;
  auto_renew: boolean | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  freeze_days_used: number | null;
  frozen_until: string | null;
  memberships: MembershipRef | MembershipRef[] | null;
};

function membershipName(m: MembershipRow["memberships"] | SaleRow["memberships"]) {
  if (!m) return "—";
  if (Array.isArray(m)) return m[0]?.name ?? "—";
  return m.name;
}

function membershipFreezeAllowed(m: MembershipRow["memberships"]): number {
  if (!m) return 0;
  const ref = Array.isArray(m) ? m[0] : m;
  return ref?.freeze_days_allowed ?? 0;
}

const SALE_COLUMNS =
  "id, sold_at, total_amount, down_payment_amount, remaining_installments, source, admin_name, comment, memberships(name), client_memberships(id, status, auto_renew, ends_at, cancelled_at)";

const MEMBERSHIP_COLUMNS =
  "id, status, source, started_at, ends_at, visits_left, auto_renew, cancelled_at, cancel_reason, freeze_days_used, frozen_until, memberships(name, freeze_days_allowed)";

/**
 * Generic по типу клиента: раздел «Клиенты» передаёт свою строку (с
 * club_status и прочим) и в onEdit получает её же, а не урезанный ClientLike.
 */
export function ClientCardDialog<C extends ClientLike>({
  open,
  onOpenChange,
  client,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: C | null;
  onEdit?: (c: C) => void;
}) {
  if (!client) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/*
          Содержимое монтируется при каждом открытии, а запросы привязаны к
          клиенту ключом: запоздавший ответ по прошлому клиенту в карточку
          нового не попадёт.
        */}
        <ClientCard
          key={client.id}
          client={client}
          onClose={() => onOpenChange(false)}
          onEdit={onEdit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ClientCard<C extends ClientLike>({
  client,
  onClose,
  onEdit,
}: {
  client: C;
  onClose: () => void;
  onEdit?: (c: C) => void;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const userId = client.user_id ?? null;

  const salesKey = ["sales", "by-client", client.id];
  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: salesKey,
    queryFn: () =>
      unwrap<SaleRow[]>(
        supabase
          .from("sales")
          .select(SALE_COLUMNS)
          .eq("client_id", client.id)
          .order("sold_at", { ascending: false }),
      ),
    meta: { errorMessage: "Не удалось загрузить продажи клиента" },
  });

  const membershipsKey = ["client_memberships", "by-client", client.id];
  const { data: memberships = [], isLoading: loadingActive } = useQuery({
    queryKey: membershipsKey,
    queryFn: () =>
      unwrap<MembershipRow[]>(
        supabase
          .from("client_memberships")
          .select(MEMBERSHIP_COLUMNS)
          .eq("client_id", client.id)
          .order("started_at", { ascending: false }),
      ),
    meta: { errorMessage: "Не удалось загрузить абонементы клиента" },
  });

  const { data: profile = null, isLoading: loadingProfile } = useQuery({
    queryKey: ["member_profiles", userId],
    queryFn: () =>
      unwrap<MemberProfile | null>(
        supabase.from("member_profiles").select("*").eq("user_id", userId!).maybeSingle(),
      ),
    enabled: !!userId,
    meta: { errorMessage: "Не удалось загрузить анкету клиента" },
  });

  // Правка абонемента меняет и его статус в истории продаж (эмбед в sales).
  const reloadMemberships = () => {
    queryClient.invalidateQueries({ queryKey: membershipsKey });
    queryClient.invalidateQueries({ queryKey: salesKey });
  };

  // Локальная дата, как в computeClubStatus/effectiveStatus: UTC-дата
  // первые часы суток (Тбилиси, UTC+4) — ещё вчерашняя, и истёкший
  // вчера абонемент показывался бы активным.
  const today = todayISO();
  // Замороженный абонемент тоже показываем как текущий.
  const active =
    memberships.find(
      (r) => r.status === "frozen" || (r.status === "active" && (!r.ends_at || r.ends_at >= today)),
    ) ?? null;
  const clubStatus = computeClubStatus(
    memberships.map((r) => ({ client_id: client.id, status: r.status, ends_at: r.ends_at })),
  );

  const name = clientName(client);
  const photo = client.photo_url || "";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="sr-only">Карточка клиента {name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20">
              {photo && <AvatarImage src={photo} alt={name} />}
              <AvatarFallback className="text-lg">{initials(name, "?")}</AvatarFallback>
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
                <div className="mt-2">
                  <AmoCrmLinkIcon href={client.crm_link} size={22} />
                </div>
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
                      <Pencil />
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
                        {saleSourceLabel(active.source)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDate(active.started_at)} →{" "}
                      {active.ends_at ? formatDate(active.ends_at) : "бессрочно"}
                      {" · "}
                      {active.visits_left == null
                        ? "посещения: безлимит"
                        : `осталось посещений: ${active.visits_left}`}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <MembershipStatusBadge m={active} />
                      <AutoRenewBadge on={active.auto_renew} />
                    </div>
                    {active.status === "frozen" && (
                      <div className="mt-1 text-xs text-blue-700">
                        Заморожен
                        {active.frozen_until ? ` до ${formatDate(active.frozen_until)}` : ""}
                      </div>
                    )}
                    {active.cancelled_at && (
                      <div className="mt-1 text-xs text-rose-700">
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
                    {sales.map((s) => {
                      const cm = s.client_memberships?.[0] ?? null;
                      return (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-medium truncate">
                                {membershipName(s.memberships)}
                              </div>
                              {cm && <MembershipStatusBadge m={cm} />}
                              {cm && effectiveStatus(cm) === "active" && (
                                <AutoRenewBadge on={cm.auto_renew} />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(s.sold_at)}
                              {" · "}
                              {saleSourceLabel(s.source)}
                              {s.admin_name ? ` · ${s.admin_name}` : ""}
                              {s.remaining_installments > 0
                                ? ` · рассрочка 1 + ${s.remaining_installments}, первый взнос ${formatMoney(Number(s.down_payment_amount))}`
                                : ""}
                            </div>
                          </div>
                          <div className="shrink-0 font-medium tabular-nums">
                            {formatMoney(Number(s.total_amount))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="visits" className="mt-4">
              <VisitsTab userId={userId} />
            </TabsContent>

            <TabsContent value="profile" className="mt-4">
              <ProfileTab profile={profile} loading={loadingProfile} hasUser={!!userId} />
            </TabsContent>
          </Tabs>
        </div>
      </DialogBody>
      <DialogFooter>
        {onEdit && (
          <Button variant="outline" onClick={() => onEdit(client)}>
            <Pencil />
            Редактировать
          </Button>
        )}
        <Button onClick={onClose}>Закрыть</Button>
      </DialogFooter>

      <EditActiveMembershipDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        membership={
          active
            ? {
                id: active.id,
                ends_at: active.ends_at,
                visits_left: active.visits_left,
                status: active.status,
                freeze_days_used: active.freeze_days_used,
                frozen_until: active.frozen_until,
                freeze_days_allowed: membershipFreezeAllowed(active.memberships),
              }
            : null
        }
        onSaved={reloadMemberships}
      />
    </>
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
        Клиент ещё не зарегистрирован в мобильном приложении — анкета появится после регистрации и
        прохождения онбординга.
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

  const goal = profile.primary_goal
    ? (GOAL_LABELS[profile.primary_goal] ?? profile.primary_goal)
    : null;
  const exp = profile.experience_level
    ? (EXPERIENCE_LABELS[profile.experience_level] ?? profile.experience_level)
    : null;
  const tf = profile.target_timeframe
    ? (TIMEFRAME_LABELS[profile.target_timeframe] ?? profile.target_timeframe)
    : null;
  const act =
    profile.current_weekly_activity != null
      ? (ACTIVITY_LABELS[profile.current_weekly_activity] ??
        String(profile.current_weekly_activity))
      : null;
  const hiit =
    profile.tried_group_hiit == null
      ? null
      : profile.tried_group_hiit
        ? "Да, формат знаком"
        : "Нет, будет впервые";
  const flags = (profile.health_flags ?? []).map((f) => HEALTH_LABELS[f] ?? f).join(", ") || null;
  const times = (profile.preferred_times ?? []).map((t) => TIME_LABELS[t] ?? t).join(", ") || null;
  const gender = profile.gender ? (PROFILE_GENDER[profile.gender] ?? profile.gender) : null;
  const ref = profile.referral_source
    ? (REFERRAL_LABELS[profile.referral_source] ?? profile.referral_source)
    : null;
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
            ? `Онбординг пройден ${formatDate(profile.onboarding_completed_at)}`
            : "Онбординг не завершён — данные неполные"}
        </span>
        {profile.updated_at && <span>обновлено {formatDate(profile.updated_at)}</span>}
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
  status: BookingStatus;
  cancelled_at: string | null;
};

function VisitsTab({ userId }: { userId: string | null }) {
  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["bookings_log", "by-user", userId],
    queryFn: () =>
      unwrap<VisitRow[]>(
        supabase
          .from("bookings_log")
          .select("id, workout_name, starts_at, status, cancelled_at")
          .eq("user_id", userId!)
          .order("starts_at", { ascending: false })
          .limit(500),
      ),
    enabled: !!userId,
    meta: { errorMessage: "Не удалось загрузить посещения клиента" },
  });

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
              <td className="px-3 py-2">{formatDateTime(r.starts_at)}</td>
              <td className="px-3 py-2">
                <BookingStatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {formatDateTime(r.cancelled_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
