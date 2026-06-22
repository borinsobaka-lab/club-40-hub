import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Dumbbell, User, MenuDots, CupStar, Card } from "@solar-icons/react";
import { useEffect, useRef, useState } from "react";

type NavItem = {
  to: "/" | "/schedule" | "/profile";
  label: string;
  Icon: typeof Home;
  exact: boolean;
};

const mainItems: NavItem[] = [
  { to: "/", label: "Главное", Icon: Home, exact: true },
  { to: "/schedule", label: "Бронь", Icon: Dumbbell, exact: false },
  { to: "/profile", label: "Профиль", Icon: User, exact: false },
];

const moreItems = [
  { to: "/results" as const, label: "Результаты", Icon: CupStar },
  { to: "/memberships" as const, label: "Абонементы", Icon: Card },
];

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLLIElement>(null);

  const moreActive = moreItems.some((i) => pathname.startsWith(i.to));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [moreOpen]);

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
      <div className="pointer-events-auto w-full max-w-md px-3 pb-3">
        <div className="flex items-end gap-2">
          {/* Main glass tile with 4 sections */}
          <div className="glass-dark relative flex-1 rounded-3xl px-1.5 py-1.5">
            <ul className="grid grid-cols-4">
              {mainItems.map(({ to, label, Icon, exact }) => (
                <li key={to}>
                  <Link
                    to={to}
                    activeOptions={{ exact }}
                    activeProps={{ className: "text-[#FFE500]" }}
                    inactiveProps={{ className: "text-white/70" }}
                    className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors active:bg-white/5"
                  >
                    <Icon className="h-6 w-6" strokeWidth={2.2} />
                    <span>{label}</span>
                  </Link>
                </li>
              ))}

              <li ref={moreRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors active:bg-white/5 ${
                    moreActive || moreOpen ? "text-[#FFE500]" : "text-white/70"
                  }`}
                >
                  <MoreHorizontal className="h-6 w-6" strokeWidth={2.2} />
                  <span>Ещё</span>
                </button>

                {moreOpen && (
                  <div
                    role="menu"
                    className="glass-dark absolute bottom-full right-0 mb-2 w-52 origin-bottom-right rounded-3xl p-1.5 animate-in fade-in zoom-in-95"
                  >
                    {moreItems.map(({ to, label, Icon }) => {
                      const active = pathname.startsWith(to);
                      return (
                        <Link
                          key={to}
                          to={to}
                          role="menuitem"
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors active:bg-white/10 ${
                            active ? "text-[#FFE500]" : "text-white/90"
                          }`}
                        >
                          <Icon className="h-5 w-5" strokeWidth={2.2} />
                          <span>{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </li>
            </ul>
          </div>

          {/* Assistant tile (disabled) */}
          <button
            type="button"
            disabled
            aria-label="Ассистент (скоро)"
            title="Скоро"
            className="assistant-glow glass-dark flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-3xl text-white/70 cursor-not-allowed"
          >
            <span className="glow-orb" />
            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[15px] font-black leading-none">
              W
            </span>
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </nav>
  );
}
