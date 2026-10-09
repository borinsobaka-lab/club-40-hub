/**
 * Иконки бокового меню — Solar LineDuotone, вынутые из @solar-icons/react.
 *
 * Пакет кладёт в каждую иконку все шесть начертаний: двадцать иконок меню
 * прибавляли к бандлу ~226 kB (51 kB gzip), из которых нужно одно. Скрипт
 * рендерит нужное начертание в статичную разметку и пишет готовые
 * компоненты в src/components/nav-icons.tsx; сам пакет — только devDependency.
 *
 * Запуск: bun run scripts/gen-nav-icons.ts. Добавляя пункт меню — допиши
 * иконку в ICONS (имя как на solar-icons.vercel.app, путь — категория в пакете).
 */
import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ICONS: Record<string, string> = {
  Bag3: "shopping",
  BellBing: "notifications",
  BillList: "money",
  Bolt: "ui",
  CalendarMinimalistic: "time",
  ChartSquare: "business",
  ChatRoundDots: "messages",
  ClipboardRemove: "notes",
  DocumentText: "notes",
  Dumbbell: "sports",
  History: "time",
  Settings: "settings",
  ShieldUser: "security",
  StarsMinimalistic: "astronomy",
  TagPrice: "money",
  TicketSale: "money",
  UserId: "users",
  UsersGroupRounded: "users",
  WalletMoney: "money",
  Widget5: "settings",
};

// HTML-атрибуты → JSX-пропсы (stroke-width → strokeWidth), пустые теги — самозакрывающиеся.
const toJsx = (markup: string) =>
  markup
    .replace(
      / ([a-z]+)-([a-z]+)=/g,
      (_, a: string, b: string) => ` ${a}${b[0].toUpperCase()}${b.slice(1)}=`,
    )
    .replace(/<(path|circle|rect|ellipse|line)([^>]*)><\/\1>/g, "<$1$2 />");

const blocks: string[] = [];
for (const [name, category] of Object.entries(ICONS)) {
  const mod = await import(`@solar-icons/react/ssr/${category}/${name}`);
  const svg = renderToStaticMarkup(createElement(mod.default, { weight: "LineDuotone" }));
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  blocks.push(
    `export const ${name} = navIcon(\n  "${name}",\n  <>\n    ${toJsx(inner).replace(/></g, ">\n    <")}\n  </>,\n);`,
  );
}

writeFileSync(
  "src/components/nav-icons.tsx",
  `/**
 * Иконки бокового меню: Solar, начертание LineDuotone.
 * Файл сгенерирован scripts/gen-nav-icons.ts — руками не править.
 */
import { forwardRef, type ReactNode, type SVGProps } from "react";

export type NavIcon = ReturnType<typeof navIcon>;

function navIcon(displayName: string, paths: ReactNode) {
  const Comp = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function Comp(props, ref) {
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" {...props}>
        {paths}
      </svg>
    );
  });
  Comp.displayName = displayName;
  return Comp;
}

${blocks.join("\n\n")}
`,
);
