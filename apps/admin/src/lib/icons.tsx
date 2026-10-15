/**
 * Иконки Hugeicons под именами lucide-react.
 *
 * Alias в vite.config превращает каждый `from "lucide-react"` в этот файл,
 * поэтому имена в компонентах менять не пришлось — включая вендоренные
 * components/ui/*, которые лучше держать близко к upstream shadcn.
 *
 * Hugeicons именует иконки по-своему (Search01Icon, Delete02Icon), но заодно
 * отдаёт псевдонимы под именами lucide — по ним и импортируем. Часть
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
  ArrowLeft as ArrowLeftArt,
  ArrowLeftRight as ArrowLeftRightArt,
  ArrowUp as ArrowUpArt,
  ArrowUpRight as ArrowUpRightArt,
  BanIcon as BanArt,
  Banknote as BanknoteArt,
  Bold as BoldArt,
  Building2 as Building2Art,
  CalendarIcon as CalendarIconArt,
  CatIcon as CatArt,
  ChartAreaIcon as ChartAreaArt,
  ChartColumnIcon as ChartColumnArt,
  ChartLineIcon as ChartLineArt,
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
  ClipboardList as ClipboardListArt,
  Copy as CopyArt,
  CreditCard as CreditCardArt,
  Download as DownloadArt,
  Ellipsis as EllipsisArt,
  ExternalLink as ExternalLinkArt,
  Eye as EyeArt,
  FlaskConical as FlaskConicalArt,
  DragDropVerticalIcon as GripVerticalArt,
  Heading2 as Heading2Art,
  HelpCircleIcon as HelpCircleArt,
  ImageIcon as ImageIconArt,
  Info as InfoArt,
  Italic as ItalicArt,
  Link as LinkArt,
  Link2 as Link2Art,
  List as ListArt,
  ListOrdered as ListOrderedArt,
  LoaderCircle as Loader2Art,
  LogIn as LogInArt,
  ArrowExpandIcon as MaximizeArt,
  MessageCircle as MessageCircleArt,
  MessageCirclePlus as MessageCirclePlusArt,
  MessageSquare as MessageSquareArt,
  Mic as MicArt,
  ArrowShrinkIcon as MinimizeArt,
  Minus as MinusArt,
  PanelLeft as PanelLeftArt,
  Pencil as PencilArt,
  Play as PlayArt,
  Plus as PlusArt,
  QrCode as QrCodeArt,
  Receipt as ReceiptArt,
  RefreshCw as RefreshCwArt,
  Repeat as RepeatArt,
  RotateCcw as RotateCcwArt,
  Ruler as RulerArt,
  Save as SaveArt,
  Search as SearchArt,
  SentIcon as SendArt,
  Shapes as ShapesArt,
  ShoppingBag as ShoppingBagArt,
  Smartphone as SmartphoneArt,
  Square as SquareArt,
  Ticket as TicketArt,
  Trash2 as Trash2Art,
  TrendingDown as TrendingDownArt,
  TrendingUp as TrendingUpArt,
  Undo2 as Undo2Art,
  Upload as UploadArt,
  UserMinus as UserMinusArt,
  UserPlus as UserPlusArt,
  UserRound as UserRoundArt,
  Users as UsersArt,
  Wallet as WalletArt,
  X as XArt,
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
export const ArrowLeft = icon(ArrowLeftArt, "ArrowLeft");
export const ArrowLeftRight = icon(ArrowLeftRightArt, "ArrowLeftRight");
export const ArrowUp = icon(ArrowUpArt, "ArrowUp");
export const ArrowUpRight = icon(ArrowUpRightArt, "ArrowUpRight");
export const Ban = icon(BanArt, "Ban");
export const Banknote = icon(BanknoteArt, "Banknote");
export const Bold = icon(BoldArt, "Bold");
export const Building2 = icon(Building2Art, "Building2");
export const CalendarIcon = icon(CalendarIconArt, "CalendarIcon");
export const Cat = icon(CatArt, "Cat");
export const ChartArea = icon(ChartAreaArt, "ChartArea");
export const ChartColumn = icon(ChartColumnArt, "ChartColumn");
export const ChartLine = icon(ChartLineArt, "ChartLine");
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
export const ClipboardList = icon(ClipboardListArt, "ClipboardList");
export const Copy = icon(CopyArt, "Copy");
export const CreditCard = icon(CreditCardArt, "CreditCard");
export const Download = icon(DownloadArt, "Download");
export const Ellipsis = icon(EllipsisArt, "Ellipsis");
export const ExternalLink = icon(ExternalLinkArt, "ExternalLink");
export const Eye = icon(EyeArt, "Eye");
export const FlaskConical = icon(FlaskConicalArt, "FlaskConical");
export const GripVertical = icon(GripVerticalArt, "GripVertical");
export const Heading2 = icon(Heading2Art, "Heading2");
export const HelpCircle = icon(HelpCircleArt, "HelpCircle");
export const ImageIcon = icon(ImageIconArt, "ImageIcon");
export const Info = icon(InfoArt, "Info");
export const Italic = icon(ItalicArt, "Italic");
export const Link = icon(LinkArt, "Link");
export const Link2 = icon(Link2Art, "Link2");
export const List = icon(ListArt, "List");
export const ListOrdered = icon(ListOrderedArt, "ListOrdered");
export const Loader2 = icon(Loader2Art, "Loader2");
export const LogIn = icon(LogInArt, "LogIn");
export const Maximize = icon(MaximizeArt, "Maximize");
export const MessageCircle = icon(MessageCircleArt, "MessageCircle");
export const MessageCirclePlus = icon(MessageCirclePlusArt, "MessageCirclePlus");
export const MessageSquare = icon(MessageSquareArt, "MessageSquare");
export const Mic = icon(MicArt, "Mic");
export const Minimize = icon(MinimizeArt, "Minimize");
export const Minus = icon(MinusArt, "Minus");
export const PanelLeft = icon(PanelLeftArt, "PanelLeft");
export const Pencil = icon(PencilArt, "Pencil");
export const Play = icon(PlayArt, "Play");
export const Plus = icon(PlusArt, "Plus");
export const QrCode = icon(QrCodeArt, "QrCode");
export const Receipt = icon(ReceiptArt, "Receipt");
export const RefreshCw = icon(RefreshCwArt, "RefreshCw");
export const Repeat = icon(RepeatArt, "Repeat");
export const RotateCcw = icon(RotateCcwArt, "RotateCcw");
export const Ruler = icon(RulerArt, "Ruler");
export const Save = icon(SaveArt, "Save");
export const Search = icon(SearchArt, "Search");
export const Send = icon(SendArt, "Send");
export const Shapes = icon(ShapesArt, "Shapes");
export const ShoppingBag = icon(ShoppingBagArt, "ShoppingBag");
export const Smartphone = icon(SmartphoneArt, "Smartphone");
export const Square = icon(SquareArt, "Square");
export const Ticket = icon(TicketArt, "Ticket");
export const Trash2 = icon(Trash2Art, "Trash2");
export const TrendingDown = icon(TrendingDownArt, "TrendingDown");
export const TrendingUp = icon(TrendingUpArt, "TrendingUp");
export const Undo2 = icon(Undo2Art, "Undo2");
export const Upload = icon(UploadArt, "Upload");
export const UserMinus = icon(UserMinusArt, "UserMinus");
export const UserPlus = icon(UserPlusArt, "UserPlus");
export const UserRound = icon(UserRoundArt, "UserRound");
export const Users = icon(UsersArt, "Users");
export const Wallet = icon(WalletArt, "Wallet");
export const X = icon(XArt, "X");
