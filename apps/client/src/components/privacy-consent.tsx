import { useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Check } from "lucide-react";

import { PrivacyPolicy } from "@/components/privacy-policy";
import { PRIVACY_POLICY_INFO } from "@/lib/legal";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

/**
 * Галочка согласия с политикой конфиденциальности на экране входа (решение
 * владельца 2026-10-13; только где есть политика — приложение Lady Stretch).
 * Без неё код не запрашивается. Ссылка открывает политику в шторке поверх
 * входа — введённая почта не теряется.
 */
export function PrivacyConsent({
  checked,
  onCheckedChange,
  invalid,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Пытались продолжить без галочки — подсветить. */
  invalid?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!PRIVACY_POLICY_INFO) return null;
  const info = PRIVACY_POLICY_INFO;

  return (
    <>
      <label className="flex cursor-pointer items-start gap-3 px-1 py-1 text-sm leading-snug">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : invalid
                ? "border-destructive"
                : "border-foreground/25",
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span className="text-muted-foreground">
          {t("Принимаю")}{" "}
          <button
            type="button"
            onClick={(e) => {
              // Ссылка внутри label — не переключать галочку.
              e.preventDefault();
              setOpen(true);
            }}
            className="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
          >
            {t("политику конфиденциальности")}
          </button>{" "}
          {t("и даю согласие на обработку персональных данных")}
        </span>
      </label>

      <DrawerPrimitive.Root open={open} onOpenChange={setOpen}>
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DrawerPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] max-w-md flex-col rounded-t-2xl bg-background outline-none"
            aria-describedby={undefined}
          >
            <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
            <DrawerPrimitive.Title className="sr-only">
              {t("Политика конфиденциальности")}
            </DrawerPrimitive.Title>
            <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
              <PrivacyPolicy info={info} />
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </>
  );
}
