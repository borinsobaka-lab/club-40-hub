import {
  AltArrowRight,
  CheckCircle,
  CloseCircle,
  LockKeyholeMinimalistic,
  TransferHorizontal,
  UsersGroupRounded,
} from "@solar-icons/react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { useLocalize, useT } from "@/i18n";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import {
  durationMinutes,
  entryColor,
  entryTrainers,
  fmtTime,
  isDiagnostic,
  replacedTrainer,
  spotsLabel,
  spotsLeft,
  trainerInitials,
  trainerPhoto,
  type PackEntry,
  bookedLabel,
} from "./entries";
import { startsIn, startsInParts } from "./starts-in";

/**
 * Текущее время с шагом в полминуты — для «начинается через». На сервере и
 * при гидратации — null (без времени), иначе разметка разошлась бы.
 */
function useNow(stepMs = 30_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/**
 * «Вы записаны» и строкой ниже «Начинается через 2 ч 15 мин» (решения
 * владельца 2026-10-14); началось — только «Вы записаны».
 */
function BookedLabel({ startsAt }: { startsAt: string }) {
  const t = useT();
  const now = useNow();
  const left = now == null ? null : startsIn(startsAt, now);
  if (!left) return <span>{t("Вы записаны")}</span>;
  const time = startsInParts(left)
    .map(({ n, unit }) =>
      unit === "d" ? t("{n} д", { n }) : unit === "h" ? t("{n} ч", { n }) : t("{n} мин", { n }),
    )
    .join(" ");
  return (
    <span className="flex flex-col gap-0.5">
      <span>{t("Вы записаны")}</span>
      <span className="font-medium">{t("Начинается через {time}", { time })}</span>
    </span>
  );
}

/**
 * Карточка тренировки пакетного приложения — одна в расписании и на главной
 * (решение владельца 2026-10-11): полоска слева — цвет тренировки, слева
 * время и продолжительность, тренеры с аватарками, свободные места.
 * Справа — стрелка: записываются только из окна тренировки, прочитав
 * описание (решение владельца 2026-10-13, кнопки «+» больше нет). Своя
 * запись — зелёная подпись «Вы записаны» с галочкой на месте строки
 * «Свободно N мест» (решение владельца 2026-10-13: места видны в окне
 * тренировки), а не розовая заливка; тренер на замене — жёлтая пометка
 * «Замена». «Закрытая запись» студии (2026-11-11) — карточка не нажимается,
 * стрелки и свободных мест нет, вместо них «Запись пока закрыта»; своя запись
 * (сделанная до закрытия) открывается как обычно — чтобы её можно было отменить.
 */
export function PackWorkoutCard({
  entry,
  isBooked,
  isWaitlisted = false,
  studioName = null,
  showBooked = false,
  hideTrainerId = null,
  bookingClosed = false,
  onOpen,
}: {
  entry: PackEntry;
  isBooked: boolean;
  isWaitlisted?: boolean;
  /** Студия занятия — у записи в другую студию сети (главная). */
  studioName?: string | null;
  /** «Моё расписание» тренера (2026-11-05): сколько записано вместо свободных мест. */
  showBooked?: boolean;
  /**
   * Не показывать этого тренера — «Моё расписание»: и так ясно, что тренировка
   * его (решение владельца 2026-11-05). На замене остаётся пометка «Замена».
   */
  hideTrainerId?: string | null;
  /** «Закрытая запись» студии занятия — карточка не нажимается. */
  bookingClosed?: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const loc = useLocalize();
  const color = entryColor(entry);
  const trainers = entryTrainers(entry)
    .filter((tr) => tr.id !== hideTrainerId)
    .map(loc);
  const meSubstitute = !!hideTrainerId && !!replacedTrainer(entry, hideTrainerId);
  const minutes = durationMinutes(entry);
  const left = spotsLeft(entry);
  const spots = spotsLabel(entry, t);
  const closed = bookingClosed && !isBooked && !isWaitlisted;
  const Row = closed ? "div" : "button";

  return (
    <Card
      className={`relative w-full overflow-hidden rounded-lg transition-colors ${
        isWaitlisted ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40" : ""
      }`}
    >
      <span
        className={`absolute bottom-0 left-0 top-0 w-1.5 ${color ? "" : "bg-muted-foreground/40"}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      <Row
        {...(closed ? {} : { type: "button" as const, onClick: onOpen })}
        className={`flex w-full items-center gap-3 p-3 pl-4 text-left ${
          closed ? "" : "transition-opacity active:opacity-80"
        }`}
      >
        <div className="flex w-12 shrink-0 flex-col items-center justify-center">
          <div className="text-center text-base font-black leading-tight tabular-nums">
            {fmtTime(entry.starts_at, t)}
          </div>
          {minutes != null && (
            <div className="mt-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {t("{n} мин", { n: minutes })}
            </div>
          )}
        </div>
        <div className="ml-1 min-w-0 flex-1">
          <div className="break-words font-semibold leading-snug">
            {isDiagnostic(entry) ? t("Диагностика") : (loc(entry.workout)?.name ?? t("Тренировка"))}
          </div>
          {studioName && (
            <div className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
              {studioName}
            </div>
          )}
          {meSubstitute && (
            <div className="mt-1.5">
              <SubstitutionChip />
            </div>
          )}
          {isWaitlisted && (
            <div className="mt-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {t("В листе ожидания")}
            </div>
          )}
          {trainers.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1">
              {trainers.map((tr) => (
                <div key={tr.id} className="flex min-w-0 items-center gap-2">
                  <SquircleAvatar size={26} className="shrink-0">
                    {trainerPhoto(tr) && (
                      <SquircleAvatarImage src={trainerPhoto(tr)!} alt={tr.full_name ?? ""} />
                    )}
                    <SquircleAvatarFallback className="bg-muted text-[10px] font-semibold text-muted-foreground">
                      {trainerInitials(tr.full_name)}
                    </SquircleAvatarFallback>
                  </SquircleAvatar>
                  <span className="truncate text-sm font-medium text-muted-foreground">
                    {tr.full_name}
                  </span>
                  {replacedTrainer(entry, tr.id) && <SubstitutionChip />}
                </div>
              ))}
            </div>
          )}
          {isBooked ? (
            // Галочка — у первой строки («Вы записаны»), а не посередине двух.
            <div className="mt-1.5 flex items-start gap-1 text-xs font-semibold leading-tight text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" weight="Bold" />
              <BookedLabel startsAt={entry.starts_at} />
            </div>
          ) : closed ? (
            <div className="mt-1.5 flex items-center gap-1 text-xs font-medium leading-none text-muted-foreground">
              <LockKeyholeMinimalistic className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
              <span>{t("Запись пока закрыта")}</span>
            </div>
          ) : showBooked ? (
            <div className="mt-1.5 flex items-center gap-1 text-xs font-medium leading-none text-muted-foreground">
              <UsersGroupRounded className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
              <span>{bookedLabel(entry, t)}</span>
            </div>
          ) : (
            spots && (
              <div
                className={`mt-1.5 flex items-center gap-1 text-xs font-medium leading-none ${
                  left === 0 ? "text-red-500" : "text-muted-foreground"
                }`}
              >
                {left === 0 ? (
                  <CloseCircle className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
                ) : (
                  <UsersGroupRounded className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
                )}
                <span>{spots}</span>
              </div>
            )
          )}
        </div>
        {!closed && <AltArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
      </Row>
    </Card>
  );
}

/** Жёлтая пометка «Замена» у тренера (карточка и окно тренировки). */
export function SubstitutionChip() {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
      <TransferHorizontal className="h-3 w-3" weight="Bold" />
      {t("Замена")}
    </span>
  );
}
