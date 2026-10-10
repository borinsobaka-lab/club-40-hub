import * as React from "react";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

export const FieldContext = React.createContext<FieldContextValue | null>(null);

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
};

/**
 * Связь контрола с обёрткой <Field>: id для подписи (клик по ней ставит фокус
 * в поле), подсказка и ошибка — в aria-describedby. Вне <Field> ничего не
 * меняет. Явные пропсы контрола важнее.
 */
export function useFieldControl(props: ControlProps): ControlProps {
  const field = React.useContext(FieldContext);
  if (!field) return {};
  return {
    id: props.id ?? field.id,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}
