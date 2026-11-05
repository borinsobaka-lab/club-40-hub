import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkoutDrawer, type WorkoutDrawerData } from "@/components/workout-drawer";
import { useAuth } from "@/hooks/use-auth";
import { useFormatStudios } from "@/hooks/use-viewed-studio";
import { useLocalize, useT } from "@/i18n";
import { bookedLabel, packEntryToDrawerData, type PackEntry } from "../entries";
import { PackWorkoutCard } from "../workout-card";
import { MY_SCHEDULE_STEP, trainerEntriesQuery, trainerMeQuery } from "./queries";

/** «Понедельник, 12 октября». */
function dayTitle(iso: string, t: ReturnType<typeof useT>) {
  return t.capitalize(t.date(iso, { weekday: "long", day: "numeric", month: "long" }));
}

/**
 * «Моё расписание» на главной — только тренеру (пользователь, которому в
 * карточке клиента указан тренер; решение владельца 2026-11-05): ближайшие
 * его тренировки по 5, «Показать ещё» — ещё 5. По нажатию — окно тренировки
 * тренера: кто записан и «О тренировке». Не тренер — блока нет.
 */
export function TrainerMySchedule() {
  const { user } = useAuth();
  const t = useT();
  const loc = useLocalize();
  const { data: me } = useQuery(trainerMeQuery(user?.id ?? null));
  const [limit, setLimit] = useState(MY_SCHEDULE_STEP);
  const { data, isLoading, isError, isFetching } = useQuery(
    trainerEntriesQuery(me?.trainer_id ?? null, limit),
  );
  const [open, setOpen] = useState<WorkoutDrawerData | null>(null);
  const { data: studios = [] } = useFormatStudios();

  const groups = useMemo(() => {
    const out: { key: string; first: string; items: PackEntry[] }[] = [];
    for (const e of data?.entries ?? []) {
      const d = new Date(e.starts_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(e);
      else out.push({ key, first: e.starts_at, items: [e] });
    }
    return out;
  }, [data]);

  if (!me) return null;
  // Студия на карточке — когда у тренера занятия в нескольких студиях.
  const multiStudio = new Set((data?.entries ?? []).map((e) => e.studio_id)).size > 1;
  const studioName = (id: string) =>
    multiStudio ? (loc(studios.find((s) => s.id === id))?.name ?? null) : null;

  return (
    <>
      <section className="bg-background rounded-b-[14px] pb-5">
        <h2 className="px-4 text-2xl font-semibold mb-3">{t("Моё расписание")}</h2>
        {isError ? (
          <Card className="mx-4 p-4 text-sm text-destructive">
            {t("Не удалось загрузить ваше расписание. Обновите страницу.")}
          </Card>
        ) : isLoading || !data ? (
          <div className="px-4 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : data.entries.length === 0 ? (
          <div className="mx-4 rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
            {t("Ближайших тренировок в расписании нет")}
          </div>
        ) : (
          <div className="px-4 space-y-5">
            {groups.map((g) => (
              <div key={g.key} className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  {dayTitle(g.first, t)}
                </div>
                {g.items.map((e) => (
                  <PackWorkoutCard
                    key={e.id}
                    entry={e}
                    isBooked={false}
                    studioName={studioName(e.studio_id)}
                    showBooked
                    hideTrainerId={me.trainer_id}
                    // В окне тоже «сколько записано», а не свободные места.
                    onOpen={() =>
                      setOpen({
                        ...packEntryToDrawerData(e, t),
                        spotsLabel: bookedLabel(e, t),
                        spotsLeft: null,
                      })
                    }
                  />
                ))}
              </div>
            ))}
            {data.hasMore && (
              <Button
                className="w-full bg-muted text-foreground hover:bg-muted/80"
                disabled={isFetching}
                onClick={() => setLimit((n) => n + MY_SCHEDULE_STEP)}
              >
                {isFetching ? "..." : t("Показать ещё")}
              </Button>
            )}
          </div>
        )}
      </section>
      <div className="h-3 bg-muted" />

      <WorkoutDrawer
        trainerMode
        data={open}
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        isBooked={false}
        isPending={false}
        onBook={() => {}}
      />
    </>
  );
}
