import { useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { AltArrowDown, CheckCircle } from "@solar-icons/react";

import { useLocalize, useT } from "@/i18n";
import { Button, buttonVariants } from "@/components/ui/button";
import { GoogleMapsIcon, YandexMapsIcon } from "@/components/map-icons";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@/lib/media";
import { setViewedStudioId, useFormatStudios, useViewedStudioId } from "@/hooks/use-viewed-studio";

/**
 * Плашка «какая студия выбрана» под быстрыми кнопками главной (пакетное
 * приложение, решение владельца 2026-10-11). По нажатию — список студий
 * формата; выбор меняет новости, услуги, контакты, расписание, тренеров и
 * абонементы (useViewedStudioId). В списке слева от названия — картинка
 * клуба из админки («Клубы», studios.photo_url; решение владельца 2026-10-14),
 * маленькая, чтобы строки не росли. Под студией (решение владельца
 * 2026-11-10) — «Выбрать» и под ней компактные кнопки «Google Карты» /
 * «Яндекс Карты» с их метками (studios.google_maps_url / yandex_maps_url из «Клубов»; нет ссылки —
 * нет кнопки). Ссылка открывается в новой вкладке — на телефоне её
 * перехватывает приложение карт.
 */
export function StudioSwitcher() {
  const t = useT();
  const loc = useLocalize();
  const { studioId, homeStudioId } = useViewedStudioId();
  const { data: studios = [] } = useFormatStudios();
  const [open, setOpen] = useState(false);
  const current = loc(studios.find((s) => s.id === studioId));
  const canSwitch = studios.length > 1;

  if (!current) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => canSwitch && setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5 text-left transition active:scale-[0.99]"
      >
        {/* Только название (решение владельца 2026-10-12: без адреса и метки),
            адрес — в списке студий. */}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-white">
          {current.name}
        </span>
        {canSwitch && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-white/80">
            {t("Сменить студию")}
            <AltArrowDown className="h-4 w-4" />
          </span>
        )}
      </button>

      <DrawerPrimitive.Root open={open} onOpenChange={setOpen} shouldScaleBackground>
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DrawerPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
            aria-describedby={undefined}
          >
            <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
            <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
              <DrawerPrimitive.Title className="text-xl font-semibold">
                {t("Выберите студию")}
              </DrawerPrimitive.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Новости, услуги, расписание и абонементы покажем для выбранной студии.")}
              </p>
              <ul className="mt-4 space-y-2">
                {studios.map(loc).map((s) => {
                  const active = s.id === studioId;
                  const photo = mediaUrl(s.photo_url, "studio-logos");
                  const pick = () => {
                    // Своя студия — сбрасываем выбор: дальше по карточке клиента.
                    setViewedStudioId(s.id === homeStudioId ? null : s.id);
                    setOpen(false);
                  };
                  const maps = [
                    s.google_maps_url && {
                      key: "google",
                      url: s.google_maps_url,
                      Icon: GoogleMapsIcon,
                      name: t("Google Карты"),
                      label: t("Показать в Google Картах"),
                    },
                    s.yandex_maps_url && {
                      key: "yandex",
                      url: s.yandex_maps_url,
                      Icon: YandexMapsIcon,
                      name: t("Яндекс Карты"),
                      label: t("Показать в Яндекс Картах"),
                    },
                  ].filter(Boolean) as {
                    key: string;
                    url: string;
                    Icon: typeof GoogleMapsIcon;
                    name: string;
                    label: string;
                  }[];
                  return (
                    <li
                      key={s.id}
                      className={`rounded-2xl border p-3 ${
                        active ? "border-primary bg-primary/5" : "border-border bg-card"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={pick}
                        className="flex w-full items-center gap-3 text-left transition active:scale-[0.99]"
                      >
                        {photo && (
                          <img
                            src={photo}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-11 w-11 shrink-0 rounded-xl bg-muted object-cover"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{s.name}</span>
                          {s.address && (
                            <span className="block truncate text-sm text-muted-foreground">
                              {s.address}
                            </span>
                          )}
                          {s.id === homeStudioId && (
                            <span className="block text-xs text-muted-foreground">
                              {t("Ваша студия — здесь можно записываться")}
                            </span>
                          )}
                        </span>
                        {active && (
                          <CheckCircle className="h-6 w-6 shrink-0 text-primary" weight="Bold" />
                        )}
                      </button>
                      <div className="mt-3 space-y-2">
                        <Button
                          className="w-full"
                          variant={active ? "outline" : "default"}
                          onClick={pick}
                        >
                          {active ? t("Выбрана") : t("Выбрать")}
                        </Button>
                        {maps.length > 0 && (
                          // Компактные пилюли (решение владельца 2026-11-10: крупные
                          // кнопки и подпись «Показать на карте» — лишнее).
                          <div className="flex flex-wrap gap-2">
                            {maps.map(({ key, url, Icon, name, label }) => (
                              <a
                                key={key}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={label}
                                className={cn(
                                  buttonVariants({ variant: "outline", size: "sm" }),
                                  "h-9 gap-1.5 px-3 text-[13px] [&_svg]:size-4",
                                )}
                              >
                                <Icon />
                                {name}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </>
  );
}
