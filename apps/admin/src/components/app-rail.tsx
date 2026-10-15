import { Link, useRouterState } from "@tanstack/react-router";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useClubRequestsBadge } from "@/hooks/use-client-requests";
import {
  ADMIN_SECTIONS,
  SECTIONS,
  canOpenPath,
  railSectionKey,
  type RailSection,
} from "@/lib/nav-sections";
import { canOpenRail } from "@/lib/admin-access";
import { cn } from "@/lib/utils";
import { RailSkeleton } from "@/components/skeletons";
import { RailAccount } from "@/components/rail-account";

function RailItem({
  section,
  active,
  badge,
  onNavigate,
}: {
  section: RailSection;
  active: boolean;
  /** Счётчик на иконке («Клуб» — неотработанные заявки клиентов). */
  badge?: number;
  onNavigate?: () => void;
}) {
  const content = (
    <>
      {/*
        Свечение за иконкой: у обычного раздела белое и только при
        наведении — как у пунктов меню; у активного разноцветное
        (rail-glow в styles.css), а иконка белая BoldDuotone.
      */}
      <span
        className={cn(
          "relative isolate inline-flex shrink-0 text-white",
          active
            ? "rail-glow"
            : "before:absolute before:-inset-1 before:-z-10 before:rounded-full before:bg-current before:opacity-0 before:blur-[6px] before:transition-opacity before:duration-200 group-hover/rail:before:opacity-45",
        )}
      >
        <section.icon active={active} className="size-5" />
        {!!badge && (
          <span
            aria-label={`Новых заявок: ${badge}`}
            className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums"
          >
            {badge}
          </span>
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 w-full text-center text-[11px] leading-tight break-words hyphens-manual",
          active ? "font-semibold text-white" : "font-medium text-white/70",
        )}
      >
        {section.title}
      </span>
    </>
  );
  const itemClass =
    "flex w-full flex-col items-center gap-1 rounded-lg py-2 outline-none focus-visible:ring-2 focus-visible:ring-white/40";

  if (!section.url) {
    return (
      <div
        aria-disabled="true"
        title="Скоро"
        className={cn(itemClass, "cursor-default opacity-40")}
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      to={section.url}
      title={section.fullTitle}
      aria-label={section.fullTitle}
      aria-current={active ? "page" : undefined}
      className={cn(itemClass, "group/rail")}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

/**
 * Рейка разделов — узкая колонка слева от бокового меню: иконка и подпись
 * под ней. Меню справа — пункты клуба («Клуб» — всё, что относится к
 * студии, и общие для студий «Сотрудники») или своё меню раздела
 * («Мобильное приложение»). Оно, как и «Доступы» и «Студии», — общее для
 * всех студий.
 */
export function AppRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const activeKey = railSectionKey(pathname);
  const access = useAdminAccess();
  const studioId = useActiveStudioId();
  const openRequests = useClubRequestsBadge();

  // Разделы, закрытые сотруднику в «Доступах», не показываем; заготовки без
  // url — как есть. «Клуб» виден, если открыт раздел рейки, — даже когда
  // в активной студии ему не открыт ни один пункт (студию можно сменить), —
  // или «Сотрудники»: они в меню клуба.
  const visible = (section: RailSection) =>
    !section.url ||
    (!!access &&
      (section.key === "club"
        ? canOpenPath(access, null, section.url) || canOpenRail(access, "staff")
        : canOpenPath(access, studioId, section.url)));

  // Пока права грузятся — скелетоны на месте разделов: иначе рейка сначала
  // пустая, а потом разделы «выпрыгивают».
  const renderGroup = (sections: RailSection[]) =>
    !access ? (
      <RailSkeleton items={sections.length} />
    ) : (
      sections
        .filter(visible)
        .map((section) => (
          <RailItem
            key={section.key}
            section={section}
            active={section.key === activeKey}
            badge={section.key === "club" ? openRequests : undefined}
            onNavigate={onNavigate}
          />
        ))
    );

  return (
    <nav
      aria-label="Разделы"
      className="sidebar-scroll flex w-(--rail-width) shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-rail px-1 py-4"
    >
      {/*
        Рабочие разделы стоят по центру высоты. my-auto, а не
        justify-center: когда разделов станет больше высоты экрана,
        justify-center обрезал бы верхние без возможности прокрутить к ним.
      */}
      <div className="my-auto flex w-full flex-col items-center gap-1">{renderGroup(SECTIONS)}</div>
      {/* Внизу: «Доступы», «Клубы» и в самом низу — кто вошёл (аватарка, по нажатию — выход). */}
      <div className="flex w-full flex-col items-center gap-1 border-t border-white/10 pt-2">
        {renderGroup(ADMIN_SECTIONS)}
        <RailAccount />
      </div>
    </nav>
  );
}
