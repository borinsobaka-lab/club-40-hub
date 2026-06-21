import { Drawer as DrawerPrimitive } from "vaul";
import logoSrc from "@/assets/frame-13.svg";

const PLACEHOLDER_DESCRIPTION =
  "Функциональная тренировка, направленная на развитие силы, выносливости и координации. Подходит для всех уровней подготовки. Занятие проходит под руководством тренера в малой группе.";

export type WorkoutDrawerData = {
  id: string;
  name: string;
  trainerName: string | null;
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
                    {data.trainerName && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                          {data.trainerName
                            .split(/\s+/)
                            .map((p) => p[0])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {data.trainerName}
                        </div>
                      </div>
                    )}
                  </div>
                  <img
                    src={logoSrc}
                    alt=""
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                </div>

                <p className="mt-4 text-[15px] leading-relaxed text-foreground/90">
                  {PLACEHOLDER_DESCRIPTION}
                </p>

                <button
                  type="button"
                  onClick={onBook}
                  disabled={isPending}
                  className="mt-6 w-full h-14 rounded-2xl bg-[#FFE500] text-[#1B1C1F] font-bold text-base active:scale-[0.99] transition disabled:opacity-60"
                >
                  {isPending ? "..." : isBooked ? "Отменить запись" : "Записаться"}
                </button>
              </>
            )}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
