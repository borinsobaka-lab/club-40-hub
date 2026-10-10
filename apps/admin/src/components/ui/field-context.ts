import { createContext, useContext } from "react";

/**
 * id контрола, который раздаёт FormField (ui/form-field.tsx). Отдельным модулем:
 * его читают Input/Textarea/SelectTrigger, и тянуть в них Checkbox/Switch из
 * form-field незачем.
 */
export const FieldIdContext = createContext<string | undefined>(undefined);

/** id контрола: явный пропс важнее того, что раздаёт FormField. */
export function useFieldId(id?: string) {
  const fromField = useContext(FieldIdContext);
  return id ?? fromField;
}
