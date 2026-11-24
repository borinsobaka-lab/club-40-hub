import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Users } from "lucide-react";

import { ClientNameLink } from "@/components/client-name-link";
import { InfoNote } from "@/components/ui/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { useTrainerPaySchemes } from "@/hooks/use-trainer-pay-schemes";
import { supabase } from "@/integrations/supabase/client";
import { schemeAmount, schemeBreakdown, schemeFor } from "@/lib/pay-schemes";
import { formatPay, plural } from "@/lib/payroll";
import { unwrap } from "@/lib/query";
import { cn } from "@/lib/utils";

/**
 * «Зарплаты» → карточка тренера на прогрессивной ставке (решение владельца
 * 2026-11-24): проведённые занятия периода по одному — день недели, время,
 * тренировка, клуб, сколько людей было, как получилась сумма; по нажатию на
 * занятие — кто был. Чтобы сверяться с тренером при начислении. Строки —
 * RPC payroll_lessons (те же, из которых складывается оклад), записанные —
 * payroll_lesson_clients (db/migrations/2026-11-24_zzz_payroll_lessons.sql).
 */

type Lesson = {
  entry_id: string;
  starts_at: string;
  ends_at: string | null;
  work_date: string;
  studio_name: string;
  kind: "group" | "personal" | "other";
  title: string | null;
  workout_id: string | null;
  workout_name: string | null;
  /** «Посетил». */
  people: number;
  /** Записи без отметки. */
  unmarked: number;
  no_show: number;
  amount: number;
};

type LessonClient = {
  client_id: string;
  client_name: string;
  status: "attended" | "booked" | "no_show";
  is_trial: boolean;
};

const TBILISI = "Asia/Tbilisi";
const TIME = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TBILISI,
});
const DAY = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

/** «Понедельник, 24 ноября» по дате YYYY-MM-DD. */
function dayTitle(iso: string) {
  const text = DAY.format(new Date(`${iso}T00:00:00`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lessonName(l: Lesson) {
  if (l.kind === "personal") return "Персональная тренировка";
  if (l.kind === "other") return l.title?.trim() || "Прочая активность";
  return l.workout_name ?? "Групповая тренировка";
}

const PEOPLE: [string, string, string] = ["человек", "человека", "человек"];
const LESSONS: [string, string, string] = ["занятие", "занятия", "занятий"];

export function PayrollLessons({
  trainerId,
  range,
}: {
  trainerId: string;
  range: { from: string; to: string };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: schemes } = useTrainerPaySchemes();
  const { data: lessons, isLoading } = useQuery({
    queryKey: ["payroll_lessons", trainerId, range.from, range.to],
    queryFn: async () =>
      (
        await unwrap<Lesson[]>(
          supabase.rpc("payroll_lessons", {
            _trainer_id: trainerId,
            _from: range.from,
            _to: range.to,
          }),
        )
      ).map((l) => ({ ...l, amount: Number(l.amount) || 0 })),
    meta: { errorMessage: "Не удалось загрузить занятия сотрудника" },
  });

  if (isLoading || !lessons)
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (lessons.length === 0)
    return <InfoNote variant="empty">За период нет проведённых занятий.</InfoNote>;

  const days = [...new Set(lessons.map((l) => l.work_date))];
  const total = lessons.reduce((sum, l) => sum + l.amount, 0);
  const people = lessons.reduce((sum, l) => sum + (l.kind === "other" ? 0 : l.people), 0);
  const unmarked = lessons.reduce((sum, l) => sum + l.unmarked, 0);

  /** Как получилась сумма — только когда расчёт по схеме сходится с начисленным. */
  const breakdown = (l: Lesson) => {
    if (l.kind !== "group") return null;
    const scheme = schemeFor(schemes?.list ?? [], schemes?.links ?? [], trainerId, l.workout_id);
    if (!scheme || Math.abs(schemeAmount(scheme, l.people) - l.amount) > 0.005) return null;
    return schemeBreakdown(scheme, l.people, formatPay);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">Проведённые занятия</h3>
        <div className="text-sm text-muted-foreground">
          {lessons.length} {plural(lessons.length, LESSONS)} · {people} {plural(people, PEOPLE)} ·{" "}
          <b className="text-foreground tabular-nums">{formatPay(total)}</b>
        </div>
      </div>
      {unmarked > 0 && (
        <InfoNote variant="warning">
          Без отметки о посещении — {unmarked}. Пока отметки не стоят, эти клиенты не считаются
          пришедшими, и сумма за занятие может быть меньше. Нажмите на занятие, чтобы увидеть, у
          кого нет отметки.
        </InfoNote>
      )}

      {days.map((day) => {
        const items = lessons.filter((l) => l.work_date === day);
        return (
          <section key={day} className="overflow-hidden rounded-lg border">
            <header className="flex items-baseline justify-between gap-3 bg-muted/50 px-3 py-1.5 text-sm">
              <span className="font-semibold">{dayTitle(day)}</span>
              <span className="text-muted-foreground tabular-nums">
                {items.length > 1 && `${items.length} ${plural(items.length, LESSONS)} · `}
                {formatPay(items.reduce((sum, l) => sum + l.amount, 0))}
              </span>
            </header>
            <ul className="divide-y">
              {items.map((l) => {
                const open = openId === l.entry_id;
                const how = breakdown(l);
                return (
                  <li key={l.entry_id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : l.entry_id)}
                      className="grid w-full cursor-pointer grid-cols-[3.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    >
                      <span className="text-muted-foreground tabular-nums">
                        {TIME.format(new Date(l.starts_at))}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{lessonName(l)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {l.studio_name}
                          {how && ` · ${how}`}
                        </span>
                      </span>
                      <span className="flex flex-col items-end text-xs">
                        {l.kind !== "other" && (
                          <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
                            <Users className="size-3.5 text-muted-foreground" />
                            {l.people}
                          </span>
                        )}
                        {l.unmarked > 0 && (
                          <span className="text-amber-700">без отметки: {l.unmarked}</span>
                        )}
                        {l.no_show > 0 && (
                          <span className="text-muted-foreground">не пришли: {l.no_show}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-16 text-right font-semibold tabular-nums">
                          {formatPay(l.amount)}
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-4 text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </span>
                    </button>
                    {open && <LessonClients trainerId={trainerId} lesson={l} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const GROUPS = [
  { status: "attended", label: "Были" },
  { status: "booked", label: "Без отметки" },
  { status: "no_show", label: "Не пришли" },
] as const;

/** Кто был на занятии — раскрывается под строкой. */
function LessonClients({ trainerId, lesson }: { trainerId: string; lesson: Lesson }) {
  const { data, isLoading } = useQuery({
    queryKey: ["payroll_lesson_clients", trainerId, lesson.entry_id],
    queryFn: () =>
      unwrap<LessonClient[]>(
        supabase.rpc("payroll_lesson_clients", {
          _trainer_id: trainerId,
          _entry_id: lesson.entry_id,
        }),
      ),
    meta: { errorMessage: "Не удалось загрузить записанных на занятие" },
  });

  return (
    <div className="space-y-2 border-t bg-muted/30 px-3 py-2.5 text-sm">
      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загрузка…
        </div>
      ) : data.length === 0 ? (
        <div className="text-muted-foreground">
          {lesson.kind === "other"
            ? "На прочую активность клиенты не записываются."
            : "На занятие никто не был записан."}
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = data.filter((c) => c.status === g.status);
          if (list.length === 0) return null;
          return (
            <div
              key={g.status}
              className="grid gap-x-3 gap-y-1 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div
                className={cn(
                  "text-xs font-semibold",
                  g.status === "booked" ? "text-amber-700" : "text-muted-foreground",
                )}
              >
                {g.label} · {list.length}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {list.map((c) => (
                  <li key={c.client_id} className="inline-flex items-center gap-1.5">
                    <ClientNameLink clientId={c.client_id} crmLink={null}>
                      {c.client_name}
                    </ClientNameLink>
                    {c.is_trial && (
                      <StatusChip tone="info" size="sm">
                        Пробное
                      </StatusChip>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
