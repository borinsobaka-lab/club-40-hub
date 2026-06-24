/**
 * Icon shim.
 *
 * Maps the lucide-react icon names used across the project to
 * @solar-icons/react (Bold Duotone weight, set globally via SolarProvider in
 * src/routes/__root.tsx).
 *
 * Vite alias rewrites `from "lucide-react"` to this file, so every existing
 * import keeps compiling without touching shadcn primitives.
 *
 * For new code, prefer importing directly from `@solar-icons/react` and
 * picking the icon that matches the entity semantically.
 */
import { forwardRef, type SVGProps } from "react";
import * as Solar from "@solar-icons/react";

type SolarIcon = (typeof Solar)[keyof typeof Solar];

type LucideProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
};

/** Wraps a Solar icon so it accepts lucide-style props (size/color/strokeWidth). */
function adapt(SolarComp: SolarIcon, displayName: string) {
  const Adapted = forwardRef<SVGSVGElement, LucideProps>(function Adapted(
    { size = 24, color, strokeWidth: _sw, absoluteStrokeWidth: _asw, ...rest },
    ref,
  ) {
    const Comp = SolarComp as unknown as React.ComponentType<
      SVGProps<SVGSVGElement> & { size?: number | string; color?: string }
    >;
    return <Comp ref={ref as never} size={size} color={color} {...rest} />;
  });
  Adapted.displayName = displayName;
  return Adapted;
}

/** Inline svg fallback for primitive shapes that don't translate to BoldDuotone (Check, X, Plus, ...). */
function primitive(
  paths: React.ReactNode,
  displayName: string,
  { fill = false }: { fill?: boolean } = {},
) {
  const Comp = forwardRef<SVGSVGElement, LucideProps>(function Comp(
    { size = 24, color = "currentColor", strokeWidth = 2, className, ...rest },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? color : "none"}
        stroke={color}
        strokeWidth={strokeWidth as number}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...rest}
      >
        {paths}
      </svg>
    );
  });
  Comp.displayName = displayName;
  return Comp;
}

// ────────────────────────────────────────────────────────────────────
// Solar-backed mappings (BoldDuotone applied globally via SolarProvider)
// ────────────────────────────────────────────────────────────────────
export const AlertTriangle = adapt(Solar.DangerTriangle, "AlertTriangle");
export const ArrowLeft = adapt(Solar.ArrowLeft, "ArrowLeft");
export const ArrowRight = adapt(Solar.ArrowRight, "ArrowRight");
export const ArrowUp = adapt(Solar.ArrowUp, "ArrowUp");
export const ArrowDown = adapt(Solar.ArrowDown, "ArrowDown");
export const BarChart3 = adapt(Solar.ChartSquare, "BarChart3");
export const Bell = adapt(Solar.Bell, "Bell");
export const Calendar = adapt(Solar.Calendar, "Calendar");
export const CalendarIcon = Calendar;
export const Cat = adapt(Solar.Cat, "Cat");
export const CheckCircle2 = adapt(Solar.CheckCircle, "CheckCircle2");
export const ChevronDown = adapt(Solar.AltArrowDown, "ChevronDown");
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = adapt(Solar.AltArrowLeft, "ChevronLeft");
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = adapt(Solar.AltArrowRight, "ChevronRight");
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = adapt(Solar.AltArrowUp, "ChevronUp");
export const ChevronsLeft = adapt(Solar.DoubleAltArrowLeft, "ChevronsLeft");
export const ChevronsRight = adapt(Solar.DoubleAltArrowRight, "ChevronsRight");
export const ChevronsUpDown = adapt(Solar.Sort, "ChevronsUpDown");
export const Copy = adapt(Solar.Copy, "Copy");
export const Dumbbell = adapt(Solar.Dumbbell, "Dumbbell");
export const ExternalLink = adapt(Solar.ArrowRightUp, "ExternalLink");
export const Flame = adapt(Solar.Fire, "Flame");
export const History = adapt(Solar.History, "History");
export const ImageIcon = adapt(Solar.Gallery, "ImageIcon");
export const Image = ImageIcon;
export const LayoutDashboard = adapt(Solar.Widget, "LayoutDashboard");
export const MessageCircle = adapt(Solar.ChatRound, "MessageCircle");
export const MessageSquare = adapt(Solar.ChatLine, "MessageSquare");
export const Mic = adapt(Solar.Microphone, "Mic");
export const MoreHorizontal = adapt(Solar.MenuDots, "MoreHorizontal");
export const Newspaper = adapt(Solar.Notebook, "Newspaper");
export const PanelLeft = adapt(Solar.Sidebar, "PanelLeft");
export const Pencil = adapt(Solar.Pen, "Pencil");
export const Phone = adapt(Solar.Phone, "Phone");
export const Plus = adapt(Solar.AddCircle, "Plus");
export const Receipt = adapt(Solar.Bill, "Receipt");
export const RefreshCw = adapt(Solar.Refresh, "RefreshCw");
export const RefreshCwOff = adapt(Solar.RefreshCircle ?? Solar.Refresh, "RefreshCwOff");
export const Save = adapt(Solar.Diskette, "Save");
export const Search = adapt(Solar.Magnifer, "Search");
export const Send = adapt(Solar.Plain, "Send");
export const Settings = adapt(Solar.Settings, "Settings");
export const Sparkles = adapt(Solar.Stars, "Sparkles");
export const Tag = adapt(Solar.Tag, "Tag");
export const Ticket = adapt(Solar.Ticket, "Ticket");
export const Trash2 = adapt(Solar.TrashBinMinimalistic, "Trash2");
export const TrendingDown = adapt(Solar.GraphDown, "TrendingDown");
export const TrendingUp = adapt(Solar.GraphUp, "TrendingUp");
export const UserCog = adapt(Solar.User, "UserCog");
export const UserPlus = adapt(Solar.UserPlus, "UserPlus");
export const Users = adapt(Solar.UsersGroupRounded, "Users");
export const Wallet = adapt(Solar.Wallet, "Wallet");
export const Zap = adapt(Solar.Bolt, "Zap");

// ────────────────────────────────────────────────────────────────────
// Lucide-style primitives kept inline (used inside shadcn checkbox/select/etc.)
// ────────────────────────────────────────────────────────────────────
export const Check = primitive(<polyline points="20 6 9 17 4 12" />, "Check");
export const X = primitive(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
  "X",
);
export const Minus = primitive(<line x1="5" y1="12" x2="19" y2="12" />, "Minus");
export const Square = primitive(<rect x="3" y="3" width="18" height="18" rx="2" />, "Square");
export const Circle = primitive(<circle cx="12" cy="12" r="10" />, "Circle");
export const GripVertical = primitive(
  <>
    <circle cx="9" cy="5" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="19" r="1" fill="currentColor" />
    <circle cx="15" cy="5" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="19" r="1" fill="currentColor" />
  </>,
  "GripVertical",
);
export const Loader2 = primitive(<path d="M21 12a9 9 0 1 1-6.219-8.56" />, "Loader2");
