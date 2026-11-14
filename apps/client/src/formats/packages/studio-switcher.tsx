import { useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { AltArrowDown, CheckCircle, MapPoint } from "@solar-icons/react";

import { useLocalize, useT } from "@/i18n";
import { buttonVariants } from "@/components/ui/button";
import { GoogleMapsIcon, YandexMapsIcon } from "@/components/map-icons";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@/lib/media";
import type { Studio } from "@/hooks/use-studios";
import { setViewedStudioId, useFormatStudios, useViewedStudioId } from "@/hooks/use-viewed-studio";

/**
 * Плашка «какая студия выбрана» под быстрыми кнопками главной (пакетное
 * приложение, решение владельца 2026-10-11). По нажатию — список студий
 * формата; выбор меняет новости, услуги, контакты, расписание, тренеров и
 * абонементы (useViewedStudioId).
 *
 * Список упрощён (решение владельца 2026-11-14 — глаза разбегались от трёх
 * розовых «Выбрать» и шести кнопок карт): строка студии нажимается целиком,
 * кнопок выбора нет. Выбранная — розовая рамка, заливка, галочка и «Выбрана»;
 * остальные — карточка с тенью и пустым кружком. Фото клуба крупнее
 * (studios.photo_url), название без общего начала («Lady Stretch»), своя
 * студия — метка «Ваша». Карты — одна кнопка «На карте», раскрывает
 * «Google Карты» / «Яндекс Карты» (studios.google_maps_url / yandex_maps_url;
 * нет ссылки — нет кнопки). Ссылка открывается в новой вкладке — на телефоне
 * её перехватывает приложение карт.
 */
export function StudioSwitcher() {
  const t = useT();
  const loc = useLocalize();
  const { studioId, homeStudioId } = useViewedStudioId();
  const { data: studios = [] } = useFormatStudios();
  const [open, setOpen] = useState(false);
  const current = loc(studios.find((s) => s.id === studioId));
  const canSwitch = studios.length > 1;
  const shortNames = shortStudioNames(studios.map(loc));

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
            {/* Заголовок вне прокрутки — список не уезжает под ручку листа. */}
            <div className="shrink-0 px-4 pb-3 pt-3">
              <DrawerPrimitive.Title className="text-xl font-semibold">
                {t("Выберите студию")}
              </DrawerPrimitive.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Покажем расписание и абонементы выбранной студии.")}
              </p>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-1">
              <ul className="space-y-3">
                {/* Выбранная — всегда первой (решение владельца 2026-11-10). */}
                {[...studios]
                  .sort((a, b) => Number(b.id === studioId) - Number(a.id === studioId))
                  .map(loc)
                  .map((s) => (
                    <StudioRow
                      key={s.id}
                      studio={s}
                      title={shortNames.get(s.id) ?? s.name}
                      active={s.id === studioId}
                      home={s.id === homeStudioId}
                      onPick={() => {
                        // Своя студия — сбрасываем выбор: дальше по карточке клиента.
                        setViewedStudioId(s.id === homeStudioId ? null : s.id);
                        setOpen(false);
                      }}
                    />
                  ))}
              </ul>
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </>
  );
}

/**
 * Названия без общего начала: «Lady Stretch Chavchavadze 51» → «Chavchavadze
 * 51», если все студии списка начинаются одинаково. Одна студия или пустой
 * остаток — полное название.
 */
function shortStudioNames(studios: { id: string; name: string }[]): Map<string, string> {
  const result = new Map<string, string>();
  if (studios.length < 2) return result;
  const words = studios.map((s) => s.name.trim().split(/\s+/));
  let common = 0;
  while (
    words.every((w) => common < w.length - 1) &&
    words.every((w) => w[common].toLowerCase() === words[0][common].toLowerCase())
  ) {
    common++;
  }
  if (common === 0) return result;
  studios.forEach((s, i) => result.set(s.id, words[i].slice(common).join(" ")));
  return result;
}

function StudioRow({
  studio: s,
  title,
  active,
  home,
  onPick,
}: {
  studio: Studio;
  title: string;
  active: boolean;
  home: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const [mapsOpen, setMapsOpen] = useState(false);
  const photo = mediaUrl(s.photo_url, "studio-logos");
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
      className={cn(
        "relative rounded-2xl border-2 p-3 transition active:scale-[0.99]",
        active
          ? "border-primary bg-primary/10"
          : "border-transparent bg-background shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-border",
      )}
    >
      {/* Кнопка на всю карточку; «На карте» и ссылки карт — поверх неё (z-10). */}
      <button
        type="button"
        onClick={onPick}
        aria-pressed={active}
        aria-label={s.name}
        className="absolute inset-0 rounded-2xl"
      />
      <div className="pointer-events-none flex items-center gap-3">
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-[72px] w-[72px] shrink-0 rounded-xl bg-muted object-cover"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <MapPoint className="h-7 w-7 text-muted-foreground" weight="BoldDuotone" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold leading-tight">{title}</div>
          {s.address && (
            <div className="mt-0.5 truncate text-sm text-muted-foreground">{s.address}</div>
          )}
          {(active || home || maps.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {active && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  {t("Выбрана")}
                </span>
              )}
              {home && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                  {t("Ваша")}
                </span>
              )}
              {maps.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMapsOpen((v) => !v)}
                  aria-expanded={mapsOpen}
                  className="pointer-events-auto relative z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium text-muted-foreground active:bg-muted"
                >
                  <MapPoint className="h-3.5 w-3.5" weight="Bold" />
                  {t("На карте")}
                  <AltArrowDown
                    className={cn("h-3.5 w-3.5 transition", mapsOpen && "rotate-180")}
                  />
                </button>
              )}
            </div>
          )}
        </div>
        {active ? (
          <CheckCircle className="h-7 w-7 shrink-0 text-primary" weight="Bold" />
        ) : (
          <span className="h-6 w-6 shrink-0 rounded-full border-2 border-muted-foreground/40" />
        )}
      </div>
      {mapsOpen && (
        <div className={cn("relative z-10 mt-3 grid gap-2", maps.length > 1 && "grid-cols-2")}>
          {maps.map(({ key, url, Icon, name, label }) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-9 w-full gap-1.5 bg-background px-3 text-[13px] [&_svg]:size-4",
              )}
            >
              <Icon />
              {name}
            </a>
          ))}
        </div>
      )}
    </li>
  );
}
