import { useState } from "react";
import { AltArrowDown, CheckCircle } from "@solar-icons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LocaleFlag, type Locale, useI18n } from "@/i18n";

/**
 * Переключатель языка: плашка «флаг в кружке + название», по нажатию —
 * список языков. На входе — справа от логотипа (решение владельца
 * 2026-10-12), ещё — в профиле. tone: "dark" — на тёмной шапке с огоньками,
 * "light" — на светлом фоне.
 */
export function LanguageSwitcher({
  tone = "dark",
  className = "",
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const { locale, setLocale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  const choose = async (code: Locale) => {
    if (code === locale || busy) return;
    setBusy(true);
    try {
      await setLocale(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("Язык")}
        className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full pl-1.5 pr-2.5 text-sm font-medium outline-none transition-colors ${
          tone === "dark"
            ? "bg-white/10 text-white active:bg-white/20"
            : "bg-muted text-foreground active:bg-muted/70"
        } ${busy ? "opacity-60" : ""} ${className}`}
      >
        <LocaleFlag locale={current.code} className="h-6 w-6" />
        <span>{current.name}</span>
        <AltArrowDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[11rem] rounded-2xl p-1.5">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => void choose(l.code)}
            className="gap-3 rounded-xl px-2.5 py-2 text-[15px]"
          >
            <LocaleFlag locale={l.code} className="h-6 w-6" />
            <span className="flex-1">{l.name}</span>
            {l.code === locale && <CheckCircle className="h-5 w-5 text-primary" weight="Bold" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
