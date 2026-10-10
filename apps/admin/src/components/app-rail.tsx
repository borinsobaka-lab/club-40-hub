import { Link, useRouterState } from "@tanstack/react-router";
// Те же Solar-иконки, что у пунктов меню: Outline, у активного раздела BoldDuotone.
import { Buildings2, City, Notebook, ShieldUser, type NavIcon } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

type RailSection = { key: string; title: string; url?: string; icon: NavIcon };

/** Раздел без url — заготовка: виден в рейке, но не нажимается. */
const SECTIONS: RailSection[] = [
  { key: "club", title: "Клуб", url: "/", icon: Buildings2 },
  { key: "scripts", title: "Скрипты", icon: Notebook },
];

/**
 * Верхнеуровневые разделы над студиями — внизу рейки. Это одиночные
 * страницы: своего меню у них нет, справа остаётся меню клуба без
 * подсвеченного пункта.
 */
const ADMIN_SECTIONS: RailSection[] = [
  { key: "access", title: "Доступы", url: "/employees", icon: ShieldUser },
  { key: "studios", title: "Студии", url: "/studios", icon: City },
];

/** Раздел текущей страницы: свой url у одиночных разделов, всё остальное — «Клуб». */
function activeSectionKey(pathname: string) {
  const own = ADMIN_SECTIONS.find(
    (s) => s.url && (pathname === s.url || pathname.startsWith(`${s.url}/`)),
  );
  return own?.key ?? "club";
}

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
          "w-full truncate text-center text-[11px] leading-tight",
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
 * под ней. Меню справа показывает пункты клуба («Клуб» — весь текущий
 * интерфейс); «Доступы» и «Студии» — общие для всех студий разделы, внизу.
 */
export function AppRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const activeKey = activeSectionKey(pathname);

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
