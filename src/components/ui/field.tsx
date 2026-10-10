import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { FieldContext } from "@/components/ui/field-context";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/*
 * Эталон полей формы (диалоги и формы на страницах):
 *
 *   <Field label="Название" required hint="…">  ← подпись сверху, подсказка снизу
 *     <Input … />                              ← id/aria подставляются сами
 *   </Field>
 *   <FieldRow> <Field…/> <Field…/> </FieldRow>  ← два поля в строку (на мобильном — столбиком)
 *   <FieldGroup title="…" description="…">      ← смысловой блок в рамке
 *   <SwitchField label="Активен" description="…" checked onCheckedChange />  ← да/нет-настройка
 *   <CheckboxField label="…" checked onCheckedChange />  ← пункт списка с множественным выбором
 *
 * Внутри <Field> — ровно один контрол (Input, Textarea, SelectTrigger,
 * комбобокс): он получает id подписи. Обязательные поля — `required`
 * (красная звёздочка); «(необязательно)» в подписи не пишем.
 */

type FieldProps = {
  label?: React.ReactNode;
  /** Справа от подписи: счётчик, ссылка, мелкое действие. */
  labelAside?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Свой id контрола, если он нужен снаружи. */
  id?: string;
  className?: string;
  children: React.ReactNode;
};

function Field({ label, labelAside, required, hint, error, id, className, children }: FieldProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const ctx = React.useMemo(
    () => ({ id: controlId, describedBy, invalid: !!error }),
    [controlId, describedBy, error],
  );

  const labelNode = label != null && (
    <Label htmlFor={controlId}>
      {label}
      {required && (
        <span aria-hidden className="ml-0.5 text-destructive">
          *
        </span>
      )}
    </Label>
  );

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn("space-y-2", className)}>
        {labelAside ? (
          <div className="flex items-center justify-between gap-2">
            {labelNode}
            <div className="text-xs text-muted-foreground">{labelAside}</div>
          </div>
        ) : (
          labelNode
        )}
        {children}
        {hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** Поля в строку: 2 (по умолчанию) или 3 колонки, на узком экране — столбиком. */
function FieldRow({
  cols = 2,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { cols?: 2 | 3 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
      {...props}
    />
  );
}

/** Смысловой блок полей в рамке: заголовок, пояснение, поля. */
function FieldGroup({
  title,
  description,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <div
      role="group"
      aria-labelledby={title ? titleId : undefined}
      className={cn("space-y-4 rounded-md border p-4", className)}
    >
      {(title || description) && (
        <div className="space-y-1">
          {title && (
            <div id={titleId} className="text-sm font-medium leading-none">
              {title}
            </div>
          )}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

type ToggleFieldProps = {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** Настройка «да/нет»: строка в рамке, подпись слева, переключатель справа. */
function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleFieldProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-center justify-between gap-4 rounded-md border p-3", className)}>
      <div className="space-y-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Пункт множественного выбора (тренеры, сегменты): галочка + подпись. */
function CheckboxField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleFieldProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="mt-px"
      />
      <div className="grid gap-1">
        <Label htmlFor={id} className="cursor-pointer font-normal leading-4">
          {label}
        </Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export { Field, FieldRow, FieldGroup, SwitchField, CheckboxField };
