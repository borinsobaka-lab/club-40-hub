import { CloseCircle, Refresh, UsersGroupRounded } from "@solar-icons/react";

import { Card } from "@/components/ui/card";
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
  spotsLabel,
  spotsLeft,
  trainerInitials,
  trainerPhoto,
  type PackEntry,
} from "./entries";

/**
 * Карточка тренировки пакетного приложения — одна в расписании и на главной
 * (решение владельца 2026-10-11): полоска слева — цвет тренировки, слева
 * время и продолжительность, тренеры с аватарками, свободные места.
 */
export function PackWorkoutCard({
  entry,
  isBooked,
  isWaitlisted = false,
  isPending = false,
  canBook = true,
  onOpen,
  onBook,
}: {
  entry: PackEntry;
  isBooked: boolean;
  isWaitlisted?: boolean;
  isPending?: boolean;
  /** Кнопка «+» (своя студия, занятие не прошло, ещё не записан). */
  canBook?: boolean;
  onOpen: () => void;
  onBook?: () => void;
}) {
  const color = entryColor(entry);
  const trainers = entryTrainers(entry);
  const minutes = durationMinutes(entry);
  const left = spotsLeft(entry);
  const spots = spotsLabel(entry);
  const muted = isBooked ? "text-primary-foreground/75" : "text-muted-foreground";

  return (
    <Card
      className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg p-3 pl-4 transition-colors ${
        isBooked
          ? "border-primary bg-primary text-primary-foreground"
          : isWaitlisted
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
            : ""
      }`}
    >
      <span
        className={`absolute bottom-0 left-0 top-0 w-1.5 ${color ? "" : "bg-muted-foreground/40"}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity active:opacity-80"
      >
        <div className="flex w-12 shrink-0 flex-col items-center justify-center">
          <div className="text-center text-base font-black leading-tight tabular-nums">
            {fmtTime(entry.starts_at)}
          </div>
          {minutes != null && (
            <div className={`mt-0.5 text-xs font-medium tabular-nums ${muted}`}>{minutes} мин</div>
          )}
        </div>
        <div className="ml-1 min-w-0 flex-1">
          <div className="break-words font-semibold leading-snug">
            {entry.workout?.name ?? "Тренировка"}
          </div>
          {isWaitlisted && (
            <div className="mt-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              В листе ожидания
            </div>
          )}
          {trainers.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1">
              {trainers.map((t) => (
                <div key={t.id} className="flex min-w-0 items-center gap-2">
                  <SquircleAvatar size={26} className="shrink-0">
                    {trainerPhoto(t) && (
                      <SquircleAvatarImage src={trainerPhoto(t)!} alt={t.full_name ?? ""} />
                    )}
                    <SquircleAvatarFallback className="bg-muted text-[10px] font-semibold text-muted-foreground">
                      {trainerInitials(t.full_name)}
                    </SquircleAvatarFallback>
                  </SquircleAvatar>
                  <span className="truncate text-sm font-medium">{t.full_name}</span>
                </div>
              ))}
            </div>
          )}
          {spots && (
            <div
              className={`mt-1.5 flex items-center gap-1 text-xs font-medium leading-none ${
                left === 0 ? (isBooked ? muted : "text-red-500") : muted
              }`}
            >
              {left === 0 ? (
                <CloseCircle className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
              ) : (
                <UsersGroupRounded className="h-3.5 w-3.5 shrink-0" weight="BoldDuotone" />
              )}
              <span>{spots}</span>
            </div>
          )}
        </div>
      </button>
      {canBook && onBook && !isBooked && !isWaitlisted && (
        <button
          type="button"
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            onBook();
          }}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors ${
            isPending ? "opacity-60" : ""
          }`}
          aria-label="Записаться"
        >
          {isPending ? (
            <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 5V19M5 12H19"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      )}
    </Card>
  );
}
