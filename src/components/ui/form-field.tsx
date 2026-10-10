import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { FieldIdContext } from "@/components/ui/field-context";
import { FieldHint } from "@/components/ui/field-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Строительные блоки форм — один вид во всех диалогах и формах страниц
 * (см. .interface-design/system.md, «Формы»).
 *
 * FormField раздаёт id через контекст: Input, Textarea, SelectTrigger и
 * SearchableCombobox берут его сами, поэтому подпись связана с полем (клик по
 * подписи ставит фокус, скринридер читает подпись) без ручных id в каждой
 * форме. Если в поле несколько контролов (диапазон дат и т. п.), передай
 * `htmlFor={null}` — тогда id не раздаётся и дубликатов не будет.
 */

export function FormField({
  label,
  hint,
  tip,
  optional,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  /** Пояснение под полем — мелким серым. */
  hint?: React.ReactNode;
  /**
   * Подсказка за значком «?» у подписи: зачем поле и что с ним происходит
   * дальше. Коротко, 1–2 предложения; у очевидных полей (имя, телефон) не нужна.
   */
  tip?: React.ReactNode;
  /** Пометка «(необязательно)» после подписи. Обязательные поля не помечаем. */
  optional?: boolean;
  /** Свой id контрола; null — не связывать подпись (несколько контролов). */
  htmlFor?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const autoId = React.useId();
  const id = htmlFor === null ? undefined : (htmlFor ?? autoId);
  return (
    <FieldIdContext.Provider value={id}>
      <div className={cn("space-y-2", className)}>
        {label && (
          <div className="flex items-center gap-1">
            <Label htmlFor={id}>
              {label}
              {optional && (
                <span className="ml-1 font-normal text-muted-foreground">(необязательно)</span>
              )}
            </Label>
            {tip && <FieldHint>{tip}</FieldHint>}
          </div>
        )}
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </FieldIdContext.Provider>
  );
}

/**
 * Включатель с подписью — строка в рамке, переключатель справа. Вся строка
 * кликабельна (label вокруг Switch). Для да/нет-настроек в формах вместо
 * голых чекбоксов.
 */
export function SwitchRow({
  title,
  hint,
  tip,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Подсказка за значком «?» у заголовка — как у FormField. */
  tip?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 rounded-md border p-3",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <span className="space-y-0.5">
        <span className="flex items-center gap-1 text-sm font-medium">
          {title}
          {tip && <FieldHint>{tip}</FieldHint>}
        </span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
  );
}

/** Вариант с чекбоксом — для выбора из нескольких (сегменты, «Безлимит» у поля). */
export function CheckboxOption({
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 text-sm",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Пояснение внутри формы или над таблицей. muted — справка, итог, подсказка;
 * warning — предупреждение о последствиях; empty — пустой список внутри формы.
 */
export function InfoNote({
  variant = "muted",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "muted" | "warning" | "empty" }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs",
        variant === "muted" && "bg-muted/40 text-muted-foreground",
        variant === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        variant === "empty" && "border-dashed text-center text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
