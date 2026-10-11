/**
 * Внешний вид поля — один на всю админку: Input, SelectTrigger,
 * SearchableCombobox, DateRangeFilter, выбор страны в телефоне, поиск в
 * шапке. Поле — прямоугольник (rounded-md) высотой 40px; кнопки, наоборот,
 * «пилюли» (button.tsx) — по форме видно, что заполняется, а что нажимается.
 *
 * Новый контрол, который выглядит как поле (триггер выбора, фильтр),
 * берёт `fieldTriggerClass` и ставит `data-field`: по этой метке в диалогах
 * поле получает серую заливку (styles.css, data-form-surface).
 */
export const fieldClass =
  "h-10 w-full rounded-md border border-input bg-transparent px-3 text-base transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

/** Поле-кнопка: открывает список, календарь, выбор страны. Шеврон — справа. */
export const fieldTriggerClass = `${fieldClass} flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap text-left`;
