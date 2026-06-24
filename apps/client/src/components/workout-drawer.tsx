import { useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Calendar } from "@solar-icons/react";
import logoSrc from "@/assets/frame-13.svg";
import { workoutTypeMeta } from "@/lib/workout-types";
import { SquircleAvatar, SquircleAvatarFallback, SquircleAvatarImage } from "@/components/ui/squircle-avatar";
import {
  googleCalendarUrl,
  outlookLiveUrl,
  downloadICS,
  type CalendarEvent,
} from "@/lib/calendar";
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
};

export function WorkoutDrawer({
  data,
  open,
  onOpenChange,
  onBook,
  isBooked,
  isPending,
}: {
  data: WorkoutDrawerData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBook: () => void;
  isBooked: boolean;
  isPending: boolean;
}) {
  const typeMeta = data ? workoutTypeMeta(data.type) : null;
  const TypeIcon = typeMeta?.icon ?? null;
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);

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
                      <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${typeMeta.bg} ${typeMeta.color}`}>
                        {TypeIcon && <TypeIcon className="h-3.5 w-3.5" />}
                        {typeMeta.label}
                      </div>
                    )}

                    {data.trainerName && (
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
                  <img
                    src={data.photo ?? logoSrc}
                    alt=""
                    className="w-28 h-28 rounded-full object-cover shrink-0 bg-muted"
                  />
                </div>

                {data.description && (
                  <p className="mt-4 text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {data.description}
                  </p>
                )}

                {isBooked ? (
                  <div className="mt-6 flex gap-2">
                    <button
                      type="button"
                      onClick={onBook}
                      disabled={isPending}
                      className="flex-1 h-14 rounded-full bg-red-500 text-white font-bold text-base active:scale-[0.99] transition disabled:opacity-60"
                    >
                      {isPending ? "..." : "Отменить запись"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalendarPickerOpen(true)}
                      disabled={!calendarEvent}
                      className="flex-1 h-14 rounded-full bg-[#FFE500] text-[#1B1C1F] font-bold text-base active:scale-[0.99] transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      <Calendar className="h-5 w-5" weight="BoldDuotone" />
                      В календарь
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onBook}
                    disabled={isPending}
                    className="mt-6 w-full h-14 rounded-full bg-[#FFE500] text-[#1B1C1F] font-bold text-base active:scale-[0.99] transition disabled:opacity-60"
                  >
                    {isPending ? "..." : "Записаться"}
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
                className="w-full h-12 rounded-full bg-muted text-foreground font-semibold text-sm active:scale-[0.99] transition inline-flex items-center justify-center gap-2 px-4"
              >
                {opt.icon && <img src={opt.icon} alt="" className="h-6 w-6 shrink-0" />}
                {opt.label}
              </button>
            ))}

          </div>
        </DialogContent>
      </Dialog>
    </DrawerPrimitive.Root>
  );
}
