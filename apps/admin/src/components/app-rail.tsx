import { Link, useRouterState } from "@tanstack/react-router";
import { ADMIN_SECTIONS, SECTIONS, railSectionKey, type RailSection } from "@/lib/nav-sections";
import { cn } from "@/lib/utils";

function RailItem({
  section,
  active,
  onNavigate,
}: {
  section: RailSection;
  active: boolean;
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
 * студии) или своё меню раздела («Мобильное приложение»). «Сотрудники»,
 * «Мобильное приложение», «Доступы» и «Студии» — общие для всех студий.
 */
export function AppRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const activeKey = railSectionKey(pathname);

  const renderGroup = (sections: RailSection[]) =>
    sections.map((section) => (
      <RailItem
        key={section.key}
        section={section}
        active={section.key === activeKey}
        onNavigate={onNavigate}
      />
    ));

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
      <div className="flex w-full flex-col items-center gap-1 border-t border-white/10 pt-2">
        {renderGroup(ADMIN_SECTIONS)}
      </div>
    </nav>
  );
}
