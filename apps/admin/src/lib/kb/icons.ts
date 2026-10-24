/**
 * Иконки баз знаний — из того же набора Solar, что рейка и меню
 * (components/nav-icons.tsx). В базе хранится ключ (kb_bases.icon);
 * незнакомый ключ — иконка по умолчанию.
 */
import {
  Book,
  Book2,
  BookBookmark,
  Case,
  ChatRoundDots,
  Crown,
  Diploma,
  Documents,
  Dumbbell,
  Flag,
  HandHeart,
  Heart,
  Lightbulb,
  MoneyBag,
  Notebook,
  Rocket,
  ShieldCheck,
  SquareAcademicCap,
  StarShine,
  Target,
  UsersGroupRounded,
  type NavIcon,
} from "@/components/nav-icons";

export const KB_ICONS: { key: string; label: string; icon: NavIcon }[] = [
  { key: "notebook", label: "Блокнот", icon: Notebook },
  { key: "book", label: "Книга", icon: Book },
  { key: "book2", label: "Книга с закладкой", icon: Book2 },
  { key: "book-bookmark", label: "Справочник", icon: BookBookmark },
  { key: "academic", label: "Обучение", icon: SquareAcademicCap },
  { key: "diploma", label: "Диплом", icon: Diploma },
  { key: "documents", label: "Документы", icon: Documents },
  { key: "case", label: "Бизнес", icon: Case },
  { key: "money", label: "Финансы", icon: MoneyBag },
  { key: "users", label: "Команда", icon: UsersGroupRounded },
  { key: "chat", label: "Общение", icon: ChatRoundDots },
  { key: "dumbbell", label: "Тренировки", icon: Dumbbell },
  { key: "hand-heart", label: "Сервис", icon: HandHeart },
  { key: "heart", label: "Забота", icon: Heart },
  { key: "lightbulb", label: "Идеи", icon: Lightbulb },
  { key: "target", label: "Цели", icon: Target },
  { key: "rocket", label: "Запуск", icon: Rocket },
  { key: "flag", label: "Стандарты", icon: Flag },
  { key: "crown", label: "Франшиза", icon: Crown },
  { key: "star", label: "Звезда", icon: StarShine },
  { key: "shield", label: "Правила", icon: ShieldCheck },
];

export const KB_DEFAULT_ICON = "notebook";

export function kbIcon(key: string | null | undefined): NavIcon {
  return (KB_ICONS.find((i) => i.key === key) ?? KB_ICONS[0]).icon;
}
