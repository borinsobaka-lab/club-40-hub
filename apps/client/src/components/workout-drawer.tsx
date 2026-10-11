import { useEffect, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Calendar } from "@solar-icons/react";
import { toast } from "sonner";
// Заглушка без фото тренировки: PNG/WebP 336×336 вместо прежнего SVG на 1,4 МБ
// (тысячи контуров карты — долго грузился и рисовался при открытии шторки).
import logoSrc from "@/assets/brand-placeholder.webp";
import { workoutTypeMeta } from "@/lib/workout-types";
import { formatCancelDeadline } from "@/hooks/use-club-settings";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { googleCalendarUrl, outlookLiveUrl, downloadICS, type CalendarEvent } from "@/lib/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import googleCalIcon from "@/assets/google-calendar.png.asset.json";
import appleCalIcon from "@/assets/apple-calendar.png.asset.json";
import outlookIcon from "@/assets/outlook.png.asset.json";

export type WorkoutDrawerData = {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  photo: string | null;
  trainerName: string | null;
  trainerPhoto: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  // Пакетное приложение (formats/packages/entries.ts): цвет тренировки вместо
  // типа, тренеры крупно — каждый с аватаркой, свободные места.
  color?: string | null;
  trainers?: { id: string; name: string; photo: string | null }[];
  spotsLabel?: string | null;
  spotsLeft?: number | null;
};

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** «Пн, 13 октября · 19:00–20:00 · 60 мин». */
function whenLabel(startsAt: string, endsAt: string | null | undefined) {
  const start = new Date(startsAt);
  const raw = start.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const day = raw.charAt(0).toUpperCase() + raw.slice(1);
  const time = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (!endsAt) return `${day} · ${time(start)}`;
  const end = new Date(endsAt);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return `${day} · ${time(start)}–${time(end)}${minutes > 0 ? ` · ${minutes} мин` : ""}`;
}

const CANCEL_REASONS = ["Заболел(а)", "Не получается прийти", "Изменились планы", "Другое"];

export function WorkoutDrawer({
  data,
  open,
  onOpenChange,
  onBook,
  isBooked,
  isWaitlisted = false,
  isFull = false,
  isPending,
  cancelMinutes,
  bookingNote,
}: {
  data: WorkoutDrawerData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBook: (reason?: string) => void;
  isBooked: boolean;
  isWaitlisted?: boolean;
  isFull?: boolean;
  isPending: boolean;
  cancelMinutes?: number;
  /** Записаться нельзя (другая студия) — текст вместо кнопки «Записаться». */
  bookingNote?: string | null;
}) {
  const isPack = !!data?.trainers;
  const typeMeta = data && !isPack ? workoutTypeMeta(data.type) : null;
  const TypeIcon = typeMeta?.icon ?? null;
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>("");

  useEffect(() => {
    setCancelReason("");
  }, [data?.id, open]);

  const cancelLocked =
    isBooked &&
    typeof cancelMinutes === "number" &&
    !!data?.startsAt &&
    new Date(data.startsAt).getTime() - Date.now() < cancelMinutes * 60_000;

  const calendarEvent: CalendarEvent | null =
    data && data.startsAt && data.endsAt
      ? {
          id: data.id,
          title: data.name,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          description: data.description,
        }
      : null;

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setCalendarPickerOpen(false);
  };

  const calendarOptions = calendarEvent
    ? [
        {
          label: "Google Календарь",
          icon: googleCalIcon.url,
          onClick: () => openExternal(googleCalendarUrl(calendarEvent)),
        },
        {
          label: "Apple Календарь",
          icon: appleCalIcon.url,
          onClick: () => {
            downloadICS(calendarEvent);
            setCalendarPickerOpen(false);
          },
        },
        {
          label: "Outlook",
          icon: outlookIcon.url,
          onClick: () => openExternal(outlookLiveUrl(calendarEvent)),
        },
        {
          label: "Другой (.ics файл)",
          icon: null,
          onClick: () => {
            downloadICS(calendarEvent);
            setCalendarPickerOpen(false);
          },
        },
      ]
    : [];

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-background outline-none max-h-[90vh]"
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
            {data && (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <DrawerPrimitive.Title className="text-2xl font-bold leading-tight break-words">
                      {data.name}
                    </DrawerPrimitive.Title>

                    {typeMeta && (
                      <div
                        className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${typeMeta.bg} ${typeMeta.color}`}
                      >
                        {TypeIcon && <TypeIcon className="h-3.5 w-3.5" />}
                        {typeMeta.label}
                      </div>
                    )}

                    {isPack && data.startsAt && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        {data.color && (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: data.color }}
                          />
                        )}
                        {whenLabel(data.startsAt, data.endsAt)}
                      </div>
                    )}

                    {isPack && data.spotsLabel && (
                      <div
                        className={`mt-1 text-sm font-semibold ${data.spotsLeft === 0 ? "text-red-500" : "text-foreground"}`}
                      >
                        {data.spotsLabel}
                      </div>
                    )}

                    {isPack && data.trainers!.length > 0 && (
                      <div className="mt-4 flex flex-col gap-3">
                        {data.trainers!.map((t) => (
                          <div key={t.id} className="flex items-center gap-3">
                            <SquircleAvatar size={48}>
                              {t.photo && <SquircleAvatarImage src={t.photo} alt={t.name} />}
                              <SquircleAvatarFallback className="bg-muted text-sm font-semibold text-muted-foreground">
                                {initialsOf(t.name)}
                              </SquircleAvatarFallback>
                            </SquircleAvatar>
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground">Тренер</div>
                              <div className="truncate text-base font-semibold">{t.name}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!isPack && data.trainerName && (
                      <div className="mt-3 flex items-center gap-2">
                        <SquircleAvatar size={32}>
                          {data.trainerPhoto && (
                            <SquircleAvatarImage src={data.trainerPhoto} alt={data.trainerName} />
                          )}
                          <SquircleAvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
                            {data.trainerName
                              .split(/\s+/)
                              .map((p) => p[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </SquircleAvatarFallback>
                        </SquircleAvatar>
                        <div className="text-sm text-muted-foreground truncate">
                          {data.trainerName}
                        </div>
                      </div>
                    )}
                  </div>
                  {(!isPack || data.photo) && (
                    <img
                      src={data.photo ?? logoSrc}
                      alt=""
                      className={`w-28 h-28 rounded-full object-cover shrink-0 bg-muted ${data.photo ? "" : "brand-art"}`}
                    />
                  )}
                </div>

                {data.description && (
                  <p className="mt-4 text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {data.description}
                  </p>
                )}

                {isBooked ? (
                  <>
                    <div className="mt-6">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">
                        Причина отмены (по желанию)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {CANCEL_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setCancelReason(cancelReason === r ? "" : r)}
                            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                              cancelReason === r
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (cancelLocked) {
                            toast.error(
                              `Тренировку можно отменить не позже чем за ${formatCancelDeadline(cancelMinutes!)} до начала`,
                            );
                            return;
                          }
                          onBook(cancelReason || undefined);
                        }}
                        disabled={isPending}
                        className={`flex-1 h-14 rounded-full bg-red-500 text-white font-bold text-base active:scale-[0.99] transition disabled:opacity-60 ${cancelLocked ? "opacity-60" : ""}`}
                      >
                        {isPending ? "..." : "Отменить запись"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalendarPickerOpen(true)}
                        disabled={!calendarEvent}
                        className="flex-1 h-14 rounded-full bg-primary text-primary-foreground font-bold text-base active:scale-[0.99] transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
                      >
                        <Calendar className="h-5 w-5" weight="BoldDuotone" />В календарь
                      </button>
                    </div>
                  </>
                ) : isWaitlisted ? (
                  <>
                    <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                      Вы в листе ожидания. Если освободится место, с вами свяжется администратор.
                    </div>
                    <button
                      type="button"
                      onClick={() => onBook()}
                      disabled={isPending}
                      className="mt-4 w-full h-14 rounded-full bg-red-500 text-white font-bold text-base active:scale-[0.99] transition disabled:opacity-60"
                    >
                      {isPending ? "..." : "Выйти из очереди"}
                    </button>
                  </>
                ) : bookingNote ? (
                  <div className="mt-6 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                    {bookingNote}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onBook()}
                    disabled={isPending}
                    className="mt-6 w-full h-14 rounded-full bg-primary text-primary-foreground font-bold text-base active:scale-[0.99] transition disabled:opacity-60"
                  >
                    {isPending ? "..." : isFull ? "Встать в очередь" : "Записаться"}
                  </button>
                )}
              </>
            )}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>

      <Dialog open={calendarPickerOpen} onOpenChange={setCalendarPickerOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Выберите календарь</DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2">
            {calendarOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={opt.onClick}
                className="relative w-full h-12 rounded-full bg-muted text-foreground font-semibold text-sm active:scale-[0.99] transition flex items-center px-4"
              >
                {opt.icon && (
                  <img
                    src={opt.icon}
                    alt=""
                    className="h-6 w-6 absolute left-4 top-1/2 -translate-y-1/2"
                  />
                )}
                <span className="w-full text-center">{opt.label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </DrawerPrimitive.Root>
  );
}
