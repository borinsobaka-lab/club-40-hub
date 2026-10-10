/**
 * Иконки Hugeicons под именами lucide-react.
 *
 * Alias в vite.config превращает каждый `from "lucide-react"` в этот файл,
 * поэтому имена в компонентах менять не пришлось — включая вендоренные
 * components/ui/*, которые лучше держать близко к upstream shadcn.
 *
 * Hugeicons именует иконки по-своему (Search01Icon, Delete02Icon), но заодно
 * отдаёт псевдонимы под именами lucide — по ним и импортируем. Девять
 * псевдонимов оказались неточными (AlertTriangle рисовался кружком,
 * RefreshCwOff не отличался от RefreshCw, Send был конвертом) — для них
 * иконка выбрана вручную, см. MANUAL в scripts/gen-icons.ts.
 *
 * Импортируем поимённо, а не через `import * as`: иначе в бандл уезжает весь
 * пакет — на Solar так и вышло, лишние 482 kB.
 *
 * Файл сгенерирован scripts/gen-icons.ts; добавляя иконку, дописывай импорт и export парой.
 */
import { forwardRef, type SVGProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon as AlertTriangleArt,
  ArrowDown as ArrowDownArt,
  ArrowUp as ArrowUpArt,
  CalendarIcon as CalendarIconArt,
  CatIcon as CatArt,
  Check as CheckArt,
  CheckCircle as CheckCircle2Art,
  ChevronDown as ChevronDownArt,
  ChevronDownIcon as ChevronDownIconArt,
  ChevronLeft as ChevronLeftArt,
  ChevronLeftIcon as ChevronLeftIconArt,
  ChevronRight as ChevronRightArt,
  ChevronRightIcon as ChevronRightIconArt,
  ChevronUp as ChevronUpArt,
  ChevronsLeft as ChevronsLeftArt,
  ChevronsRight as ChevronsRightArt,
  Circle as CircleArt,
  Copy as CopyArt,
  ExternalLink as ExternalLinkArt,
  Eye as EyeArt,
  HelpCircleIcon as HelpCircleArt,
  ImageIcon as ImageIconArt,
  LoaderCircle as Loader2Art,
  LogIn as LogInArt,
  MessageCircle as MessageCircleArt,
  MessageSquare as MessageSquareArt,
  Mic as MicArt,
  Minus as MinusArt,
  PanelLeft as PanelLeftArt,
  Pencil as PencilArt,
  Plus as PlusArt,
  Receipt as ReceiptArt,
  RefreshCw as RefreshCwArt,
  Save as SaveArt,
  Search as SearchArt,
  SentIcon as SendArt,
  Square as SquareArt,
  Tag as TagArt,
  Trash2 as Trash2Art,
  TrendingDown as TrendingDownArt,
  TrendingUp as TrendingUpArt,
  UserPlus as UserPlusArt,
  Wallet as WalletArt,
  X as XArt,
  Zap as ZapArt,
} from "@hugeicons/core-free-icons";

type LucideProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

/** Обёртка, принимающая пропсы в стиле lucide (size / color / strokeWidth). */
function icon(art: IconSvgElement, displayName: string) {
  const Comp = forwardRef<SVGSVGElement, LucideProps>(function Comp(props, ref) {
    return <HugeiconsIcon ref={ref} icon={art} {...props} />;
  });
  Comp.displayName = displayName;
  return Comp;
}

export const AlertTriangle = icon(AlertTriangleArt, "AlertTriangle");
export const ArrowDown = icon(ArrowDownArt, "ArrowDown");
export const ArrowUp = icon(ArrowUpArt, "ArrowUp");
export const CalendarIcon = icon(CalendarIconArt, "CalendarIcon");
export const Cat = icon(CatArt, "Cat");
export const Check = icon(CheckArt, "Check");
export const CheckCircle2 = icon(CheckCircle2Art, "CheckCircle2");
export const ChevronDown = icon(ChevronDownArt, "ChevronDown");
export const ChevronDownIcon = icon(ChevronDownIconArt, "ChevronDownIcon");
export const ChevronLeft = icon(ChevronLeftArt, "ChevronLeft");
export const ChevronLeftIcon = icon(ChevronLeftIconArt, "ChevronLeftIcon");
export const ChevronRight = icon(ChevronRightArt, "ChevronRight");
export const ChevronRightIcon = icon(ChevronRightIconArt, "ChevronRightIcon");
export const ChevronUp = icon(ChevronUpArt, "ChevronUp");
export const ChevronsLeft = icon(ChevronsLeftArt, "ChevronsLeft");
export const ChevronsRight = icon(ChevronsRightArt, "ChevronsRight");
export const Circle = icon(CircleArt, "Circle");
export const Copy = icon(CopyArt, "Copy");
export const ExternalLink = icon(ExternalLinkArt, "ExternalLink");
export const Eye = icon(EyeArt, "Eye");
export const HelpCircle = icon(HelpCircleArt, "HelpCircle");
export const ImageIcon = icon(ImageIconArt, "ImageIcon");
export const Loader2 = icon(Loader2Art, "Loader2");
export const LogIn = icon(LogInArt, "LogIn");
export const MessageCircle = icon(MessageCircleArt, "MessageCircle");
export const MessageSquare = icon(MessageSquareArt, "MessageSquare");
export const Mic = icon(MicArt, "Mic");
export const Minus = icon(MinusArt, "Minus");
export const PanelLeft = icon(PanelLeftArt, "PanelLeft");
export const Pencil = icon(PencilArt, "Pencil");
export const Plus = icon(PlusArt, "Plus");
export const Receipt = icon(ReceiptArt, "Receipt");
export const RefreshCw = icon(RefreshCwArt, "RefreshCw");
export const Save = icon(SaveArt, "Save");
export const Search = icon(SearchArt, "Search");
export const Send = icon(SendArt, "Send");
export const Square = icon(SquareArt, "Square");
export const Tag = icon(TagArt, "Tag");
export const Trash2 = icon(Trash2Art, "Trash2");
export const TrendingDown = icon(TrendingDownArt, "TrendingDown");
export const TrendingUp = icon(TrendingUpArt, "TrendingUp");
export const UserPlus = icon(UserPlusArt, "UserPlus");
export const Wallet = icon(WalletArt, "Wallet");
export const X = icon(XArt, "X");
export const Zap = icon(ZapArt, "Zap");
