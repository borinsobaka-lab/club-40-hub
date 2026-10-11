import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import {
  AltArrowRight,
  Bell,
  ChatSquare,
  Phone,
  Star,
  ClipboardText,
  Ghost,
} from "@solar-icons/react";
import giftIcon from "@/assets/gift.png";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { mediaUrl } from "@/lib/media";
import { PageShell } from "@/components/page-shell";
import { useClubSettings } from "@/hooks/use-club-settings";
import { useViewedStudioId } from "@/hooks/use-viewed-studio";
import { IS_PACKAGES } from "@/lib/terms";
import {
  PACK_ENTRY_SELECT,
  packEntryToDrawerData,
  type PackEntry,
} from "@/formats/packages/entries";
import { PackWorkoutCard } from "@/formats/packages/workout-card";
import { StudioSwitcher } from "@/formats/packages/studio-switcher";

import { ContentDrawer } from "@/components/content-drawer";
import { StatsSection } from "@/components/stats-section";
import { WorkoutDrawer, type WorkoutDrawerData } from "@/components/workout-drawer";
import { entryToDrawerData, workoutTypeMeta } from "@/lib/workout-types";
import { toast } from "sonner";
import { CarouselSkeleton } from "@/components/content-skeletons";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Главное — Base40" },
      {
        name: "description",
        content: "Главная страница Base40: новости, акции и быстрый доступ к профилю.",
      },
    ],
  }),
  component: HomePage,
});

const DAY_NAMES_FULL = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function firstNameOnly(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "";
}

type News = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  position: number;
};

type Service = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  button_text: string | null;
  button_url: string | null;
  position: number;
};

type Trainer = { id: string; full_name: string | null; photo_url: string | null };
type MyBooking = {
  entry_id: string;
  entry: {
    id: string;
    starts_at: string;
    ends_at: string;
    workout: {
      name: string;
      type: string | null;
      description: string | null;
      photo_url: string | null;
    } | null;
    trainers: { trainer: Trainer | null }[] | null;
  } | null;
};

function HomePage() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState<string>("Участник");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [news, setNews] = useState<News[] | null>(null);
  const [openNewsId, setOpenNewsId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [openServiceId, setOpenServiceId] = useState<string | null>(null);
  const [myBookings, setMyBookings] = useState<MyBooking[] | null>(null);
  // Ошибки загрузки — отдельно: иначе они выглядели как «пусто».
  const [bookingsError, setBookingsError] = useState(false);
  const [newsError, setNewsError] = useState(false);
  const [servicesError, setServicesError] = useState(false);
  const [openEntry, setOpenEntry] = useState<WorkoutDrawerData | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Кнопки «Написать/Позвонить/Фидбэк» — смотримой студии; срок отмены записи
  // — своей (записи клиента всегда в своей студии).
  const clubSettings = useClubSettings();
  const homeSettings = useClubSettings("home");
  // Новости и услуги — смотримой студии (переключатель пакетного приложения;
  // в подписочном — всегда своя).
  const { studioId, studioReady } = useViewedStudioId();

  useEffect(() => {
    if (!user) {
      setMyBookings([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      // Явный фильтр по user_id: RLS позволяет тренеру видеть все брони студии,
      // и без него у сотрудника в клиентском приложении чужие записи выглядели
      // бы как его собственные.
      // Только предстоящие (через !inner-связь с занятием) — без всей истории
      // броней; групповые неотменённые — как в расписании.
      const { data, error } = await (supabase as any)
        .from("schedule_bookings")
        .select(
          IS_PACKAGES
            ? // Пакетное — карточка как в расписании: цвет, места, фото тренеров.
              `entry_id, entry:schedule_entries!inner(${PACK_ENTRY_SELECT})`
            : "entry_id, entry:schedule_entries!inner(id, starts_at, ends_at, workout:workouts(name, type, description, photo_url), trainers:schedule_entry_trainers(trainer:trainers(id, full_name, photo_url)))",
        )
        .eq("user_id", user.id)
        .eq("status", "booked")
        .gte("entry.starts_at", new Date().toISOString())
        .eq("entry.kind", "group")
        .is("entry.cancelled_at", null)
        .limit(50);
      if (cancelled) return;
      if (error) {
        setBookingsError(true);
        return;
      }
      setBookingsError(false);
      const rows = ((data as MyBooking[] | null) ?? [])
        .filter((r) => r.entry && new Date(r.entry.starts_at).getTime() >= Date.now())
        .sort(
          (a, b) => new Date(a.entry!.starts_at).getTime() - new Date(b.entry!.starts_at).getTime(),
        );
      setMyBookings(rows);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const groupedBookings = useMemo(() => {
    if (!myBookings) return null;
    const groups = new Map<number, MyBooking[]>();
    for (const b of myBookings) {
      if (!b.entry) continue;
      const key = startOfDay(new Date(b.entry.starts_at)).getTime();
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, items]) => ({ ts, items }));
  }, [myBookings]);

  async function cancelBooking(entryId: string, reason?: string) {
    if (pendingId) return;
    setPendingId(entryId);
    const { data, error } = await (supabase as any).rpc("cancel_schedule_booking", {
      p_entry_id: entryId,
      // Причину шторка передаёт и здесь: раньше параметр терялся, и отмена с
      // главной сохранялась без причины, а из расписания — с причиной.
      p_reason: reason ?? null,
    });
    setPendingId(null);
    if (error) {
      toast.error(`Не удалось отменить запись: ${error.message}`);
      return;
    }
    const res = data as { ok: boolean; reason?: string } | null;
    if (res?.ok) {
      setMyBookings((prev) => (prev ?? []).filter((b) => b.entry_id !== entryId));
      setOpenEntry(null);
      toast.success("Запись отменена");
    } else if (res?.reason) {
      toast.error(`Не удалось отменить запись: ${res.reason}`);
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("clients")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as {
          full_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          photo_url?: string | null;
        } | null;
        const name =
          row?.first_name?.trim() ||
          firstNameOnly(row?.full_name) ||
          firstNameOnly(user.user_metadata?.first_name as string | undefined) ||
          firstNameOnly(user.user_metadata?.full_name as string | undefined) ||
          "Участник";
        setFullName(name);
        setAvatarUrl(row?.photo_url ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!studioReady) return;
    let cancelled = false;
    const load = () => {
      // Новости — тех студий, что выбраны у новости в админке (studio_ids);
      // клиент без карточки (студия неизвестна) видит все.
      let q = supabase.from("news").select("id,title,description,image_url,position");
      if (studioId) q = q.contains("studio_ids", [studioId]);
      return q
        .order("position", { ascending: true })
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (cancelled) return;
          // При ошибке обновления уже показанные новости не стираем.
          if (error) {
            setNewsError(true);
            return;
          }
          setNewsError(false);
          setNews((data as News[] | null) ?? []);
        });
    };
    load();
    // Уникальное имя канала: supabase.channel() с тем же именем возвращает
    // ещё не закрытый (leaving) канал из прошлого эффекта, и subscribe() на
    // нём молча ничего не делает — обновления переставали приходить.
    const channel = supabase
      .channel(`news-feed-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "news" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [studioReady, studioId]);

  useEffect(() => {
    if (!studioReady) return;
    let cancelled = false;
    const load = () => {
      // Услуги — по студиям, как и новости.
      let q = (supabase as any)
        .from("services")
        .select("id,title,description,image_url,button_text,button_url,position");
      if (studioId) q = q.contains("studio_ids", [studioId]);
      return q
        .order("position", { ascending: true })
        .order("created_at", { ascending: false })
        .then(({ data, error }: { data: Service[] | null; error: unknown }) => {
          if (cancelled) return;
          if (error) {
            setServicesError(true);
            return;
          }
          setServicesError(false);
          setServices((data as Service[] | null) ?? []);
        });
    };
    load();
    const channel = supabase
      .channel(`services-feed-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [studioReady, studioId]);

  return (
    <PageShell
      header={
        <div className="pt-2 pb-4">
          {/* Header */}
          <div className="px-4 flex items-center justify-between">
            <Link
              to="/profile"
              className="flex items-center gap-3 min-w-0 flex-1 -ml-1 rounded-xl px-1 py-1 active:bg-accent/50 transition-colors"
            >
              <SquircleAvatar size={44}>
                {avatarUrl && <SquircleAvatarImage src={avatarUrl} alt={fullName} />}
                <SquircleAvatarFallback className="bg-muted text-foreground text-sm font-semibold">
                  {initials(fullName)}
                </SquircleAvatarFallback>
              </SquircleAvatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-semibold truncate">{fullName}</span>
                  <AltArrowRight className="h-4 w-4 text-white/70 shrink-0" weight="BoldDuotone" />
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label="Подарки"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-gradient-to-r from-rose-500 via-orange-400 to-amber-300 active:opacity-90 transition-opacity shadow-md"
              >
                <img src={giftIcon} alt="Подарки" className="h-5 w-5 object-contain" />
              </button>
              <Link
                to="/notifications"
                aria-label="Уведомления"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors"
              >
                <Bell className="h-5 w-5 text-white" />
              </Link>
            </div>
          </div>

          {/* News */}
          <section className="mt-3">
            {news === null && newsError ? (
              <div className="mx-4 h-44 rounded-2xl border border-dashed border-border flex items-center justify-center text-center px-4 text-sm text-destructive bg-background/40">
                Не удалось загрузить новости. Обновите страницу.
              </div>
            ) : news === null ? (
              <CarouselSkeleton cards={3} className="h-44 w-32" />
            ) : news.length === 0 ? (
              <div className="mx-4 h-44 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground gap-2 bg-background/40">
                <ClipboardText className="h-6 w-6" weight="BoldDuotone" />
                <span className="text-sm">Пока нет новостей</span>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto px-4 snap-x snap-mandatory no-scrollbar scroll-pl-4 scroll-pr-4">
                {news.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setOpenNewsId(n.id)}
                    className="relative shrink-0 snap-start w-32 h-44 rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                  >
                    {(() => {
                      const url = mediaUrl(n.image_url);
                      return url ? (
                        <img
                          src={url}
                          alt={n.title}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary" />
                      );
                    })()}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                    <div className="absolute inset-0 flex flex-col justify-end p-2.5">
                      <div className="text-white text-xs font-semibold leading-tight">
                        {n.title}
                      </div>
                      {n.description && (
                        <div className="text-white/80 text-[11px] leading-tight mt-0.5">
                          {n.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Быстрые действия */}
          {/* Пакетное: под кнопками — выбранная студия с переключателем. */}
          {(clubSettings.write_url || clubSettings.call_url || clubSettings.feedback_url) && (
            <section className="px-4 my-3">
              <div className="rounded-2xl bg-white/10 backdrop-blur-md p-1.5">
                <div className="flex items-stretch justify-between gap-2">
                  {[
                    { icon: ChatSquare, label: "Написать", href: clubSettings.write_url },
                    { icon: Phone, label: "Позвонить", href: clubSettings.call_url },
                    { icon: Star, label: "Фидбэк", href: clubSettings.feedback_url },
                  ]
                    .filter((item) => !!item.href)
                    .map((item) => (
                      <a
                        key={item.label}
                        href={item.href!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1 active:scale-[0.97] transition"
                      >
                        <item.icon className="h-5 w-5 text-white" />
                        <span className="text-[11px] font-semibold text-white/80">
                          {item.label}
                        </span>
                      </a>
                    ))}
                </div>
              </div>
            </section>
          )}

          {IS_PACKAGES && (
            <section className="px-4 my-3">
              <StudioSwitcher />
            </section>
          )}
        </div>
      }
    >
      <div className="pt-6 pb-8">
        <div className="bg-muted">
          {/* Тренировки */}
          <section className="bg-background rounded-b-[14px] pb-5">
            <h2 className="px-4 text-2xl font-semibold mb-3">Тренировки</h2>
            {bookingsError ? (
              <Card className="mx-4 p-4 text-sm text-destructive">
                Не удалось загрузить ваши записи. Обновите страницу.
              </Card>
            ) : myBookings === null ? (
              <CarouselSkeleton cards={2} className="h-24 w-56" />
            ) : myBookings.length === 0 ? (
              <div className="mx-4 rounded-2xl border border-border bg-card p-5 flex flex-col items-center text-center gap-3">
                <Ghost className="h-14 w-14 text-muted-foreground ghost-nudge" />
                <div className="text-sm text-muted-foreground">
                  У вас нет запланированных тренировок
                </div>
                <Button asChild className="text-sm font-bold">
                  <Link to="/schedule">{IS_PACKAGES ? "Записаться" : "Забронировать"}</Link>
                </Button>
              </div>
            ) : (
              <div className="px-4 space-y-5">
                {groupedBookings!.map((group) => {
                  const d = new Date(group.ts);
                  const weekday = DAY_NAMES_FULL[d.getDay()];
                  const dateLabel = d.toLocaleDateString("ru-RU", {
                    day: "2-digit",
                    month: "long",
                  });
                  return (
                    <div key={group.ts} className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        {weekday}, {dateLabel}
                      </div>
                      {group.items.map((b) => {
                        const e = b.entry!;
                        if (IS_PACKAGES) {
                          const pe = e as unknown as PackEntry;
                          return (
                            <PackWorkoutCard
                              key={b.entry_id}
                              entry={pe}
                              isBooked
                              canBook={false}
                              onOpen={() => setOpenEntry(packEntryToDrawerData(pe))}
                            />
                          );
                        }
                        const meta = workoutTypeMeta(e.workout?.type);
                        const timeLabel = new Date(e.starts_at).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        const trainerNames = (e.trainers ?? [])
                          .map((t) => t.trainer?.full_name)
                          .filter((n): n is string => !!n);
                        return (
                          <button
                            key={b.entry_id}
                            type="button"
                            onClick={() => setOpenEntry(entryToDrawerData(e))}
                            className="w-full text-left active:opacity-80 transition-opacity"
                          >
                            <Card className="relative p-3 pl-4 flex items-center gap-3 w-full overflow-hidden rounded-lg bg-primary text-primary-foreground border-primary">
                              <span
                                className={`absolute left-0 top-0 bottom-0 w-1.5 ${meta.stripe}`}
                              />
                              <div className="flex flex-col items-center justify-center w-12 shrink-0">
                                <div className="text-base font-black tabular-nums leading-tight text-center">
                                  {timeLabel}
                                </div>
                              </div>
                              <div className="flex-1 min-w-0 ml-1">
                                <div className="font-medium break-words leading-snug">
                                  {e.workout?.name ?? "Занятие"}
                                </div>
                                {trainerNames.length > 0 && (
                                  <div className="text-xs mt-0.5 truncate text-primary-foreground/70">
                                    {trainerNames.join(", ")}
                                  </div>
                                )}
                              </div>
                            </Card>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="h-3 bg-muted" />

          {/* Статистика */}
          <StatsSection />

          <div className="h-3 bg-muted" />

          {/* Услуги */}
          <section className="bg-background rounded-t-[14px] pt-5 pb-0">
            <h2 className="px-4 text-2xl font-semibold">Услуги</h2>
            <p className="px-4 text-sm text-muted-foreground mb-3">
              Дополнительные возможности для {IS_PACKAGES ? "клиентов студии" : "участников клуба"}
            </p>
            {services === null && servicesError ? (
              <div className="mx-4 h-32 rounded-2xl border border-dashed border-border flex items-center justify-center text-center px-4 text-sm text-destructive">
                Не удалось загрузить услуги. Обновите страницу.
              </div>
            ) : services === null ? (
              <CarouselSkeleton cards={3} className="h-32 w-56" />
            ) : services.length === 0 ? (
              <div className="mx-4 h-32 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground gap-2">
                <ClipboardText className="h-6 w-6" weight="BoldDuotone" />
                <span className="text-sm">Пока нет услуг</span>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar scroll-pl-4 scroll-pr-4">
                <div className="w-1 shrink-0 snap-none" aria-hidden="true" />
                {services.map((s) => {
                  const url = mediaUrl(s.image_url, "services-media");
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setOpenServiceId(s.id)}
                      className="relative shrink-0 snap-start w-56 h-32 rounded-2xl overflow-hidden text-left bg-muted active:scale-[0.98] transition-transform"
                    >
                      {url ? (
                        <img
                          src={url}
                          alt={s.title}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <div className="absolute inset-0 flex flex-col justify-end p-3">
                        <div className="text-white text-sm font-semibold leading-tight">
                          {s.title}
                        </div>
                        {s.description && (
                          <div className="text-white/80 text-[11px] leading-tight mt-0.5 line-clamp-1">
                            {s.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                <div className="w-1 shrink-0 snap-none" aria-hidden="true" />
              </div>
            )}
          </section>
        </div>
      </div>

      <ContentDrawer
        kind="news"
        itemId={openNewsId}
        onOpenChange={(o) => {
          if (!o) setOpenNewsId(null);
        }}
      />

      <ContentDrawer
        kind="service"
        itemId={openServiceId}
        onOpenChange={(o) => {
          if (!o) setOpenServiceId(null);
        }}
      />

      <WorkoutDrawer
        data={openEntry}
        open={openEntry !== null}
        onOpenChange={(o) => {
          if (!o) setOpenEntry(null);
        }}
        isBooked={true}
        isPending={openEntry ? pendingId === openEntry.id : false}
        cancelMinutes={homeSettings.cancel_booking_minutes}
        onBook={(reason) => {
          if (openEntry) cancelBooking(openEntry.id, reason);
        }}
      />
    </PageShell>
  );
}
