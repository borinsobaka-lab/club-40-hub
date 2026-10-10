/**
 * Иконки бокового меню — Solar, вынутые из @solar-icons/react: Outline для
 * обычного пункта, BoldDuotone для активного.
 *
 * Пакет кладёт в каждую иконку все шесть начертаний: двадцать иконок меню
 * прибавляли к бандлу ~226 kB (51 kB gzip), из которых нужно два. Скрипт
 * рендерит нужные начертания в статичную разметку и пишет готовые
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
  Buildings2: "building",
  Bolt: "ui",
  CalendarMinimalistic: "time",
  ChartSquare: "business",
  ChatRoundDots: "messages",
  City: "building",
  ClipboardRemove: "notes",
  DocumentText: "notes",
  Dumbbell: "sports",
  History: "time",
  Notebook: "notes",
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

const WEIGHTS = { outline: "Outline", active: "BoldDuotone" } as const;

const render = (Icon: Parameters<typeof createElement>[0], weight: string) => {
  const svg = renderToStaticMarkup(createElement(Icon, { weight }));
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<>\n      ${toJsx(inner).replace(/></g, ">\n      <")}\n    </>`;
};

const blocks: string[] = [];
for (const [name, category] of Object.entries(ICONS)) {
  const mod = await import(`@solar-icons/react/ssr/${category}/${name}`);
  const variants = Object.entries(WEIGHTS)
    .map(([key, weight]) => `    ${key}: ${render(mod.default, weight)},`)
    .join("\n");
  blocks.push(`export const ${name} = navIcon("${name}", {\n${variants}\n});`);
}

writeFileSync(
  "src/components/nav-icons.tsx",
  `/**
 * Иконки бокового меню: Solar, Outline у обычного пункта и BoldDuotone
 * у активного (проп \`active\`).
 * Файл сгенерирован scripts/gen-nav-icons.ts — руками не править.
 */
import { forwardRef, type ReactNode, type SVGProps } from "react";

export type NavIcon = ReturnType<typeof navIcon>;

type NavIconProps = SVGProps<SVGSVGElement> & { active?: boolean };

function navIcon(displayName: string, paths: { outline: ReactNode; active: ReactNode }) {
  const Comp = forwardRef<SVGSVGElement, NavIconProps>(function Comp({ active, ...props }, ref) {
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" {...props}>
        {active ? paths.active : paths.outline}
      </svg>
    );
  });
  Comp.displayName = displayName;
  return Comp;
}

${blocks.join("\n\n")}
`,
);
