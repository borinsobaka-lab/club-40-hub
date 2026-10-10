import { Link } from "@tanstack/react-router";
// Те же Solar-иконки, что у пунктов меню: Outline, у активного раздела BoldDuotone.
import { Buildings2, Notebook, type NavIcon } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

type RailSection = { key: string; title: string; url?: string; icon: NavIcon };

/** Раздел без url — заготовка: виден в рейке, но не нажимается. */
const SECTIONS: RailSection[] = [
  { key: "club", title: "Клуб", url: "/", icon: Buildings2 },
  { key: "scripts", title: "Скрипты", icon: Notebook },
];

/**
 * Рейка разделов — узкая колонка слева от бокового меню: иконка и подпись
 * под ней. Меню справа показывает пункты активного раздела; пока раздел один
 * («Клуб» — весь текущий интерфейс), поэтому он активен всегда.
 */
export function AppRail({ onNavigate }: { onNavigate?: () => void }) {
  const activeKey = "club";

  return (
    <nav
      aria-label="Разделы"
      className="sidebar-scroll flex w-(--rail-width) shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-white/10 bg-rail px-1.5 py-4"
    >
      {SECTIONS.map((section) => {
        const active = section.key === activeKey;
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
              <section.icon active={active} className="size-6" />
            </span>
            <span
              className={cn(
                "w-full truncate text-center text-xs leading-tight",
                active ? "font-semibold text-white" : "font-medium text-white/70",
              )}
            >
              {section.title}
            </span>
          </>
        );
        const itemClass =
          "flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-white/40";

        if (!section.url) {
          return (
            <div
              key={section.key}
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
            key={section.key}
            to={section.url}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, "group/rail")}
            onClick={onNavigate}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
