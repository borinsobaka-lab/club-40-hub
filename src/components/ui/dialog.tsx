"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      // Метка для заливки полей (styles.css): поля в окнах светло-серые.
      data-form-surface=""
      className={cn(
        // На телефоне окно почти во весь экран: 8px до краёв и почти вся высота
        // (dvh — без адресной строки), иначе в форму мало что влезает. С sm —
        // привычные поля вокруг и 85% высоты.
        "fixed left-[50%] top-[50%] z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg sm:max-h-[85vh] sm:w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      {/* Крестик — полноценная кнопка 32px (раньше голая иконка 16px, в которую
          трудно попасть); стоит по центру строки заголовка шапки. */}
      <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Закрыть</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Шапка диалога — закреплена: `shrink-0`, поэтому не уезжает при прокрутке
 * тела. Отступ и разделитель здесь, а не на DialogContent: контент прокручивается
 * между шапкой и подвалом, и полоса прокрутки не должна на них заезжать.
 */
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Текст всегда слева — по центру (как в shadcn на мобильных) он
      // отрывался от полей, которые выровнены влево.
      "flex shrink-0 flex-col space-y-1.5 border-b px-4 py-4 pr-12 text-left sm:px-6",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

/**
 * Тело диалога — единственная прокручиваемая часть. Всё, что между шапкой и
 * подвалом, кладём сюда; свой `max-h` и `overflow` на DialogContent вешать не
 * нужно (и нельзя — тогда поедут шапка с подвалом).
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6", className)} {...props} />
);
DialogBody.displayName = "DialogBody";

/**
 * Форма вокруг тела и подвала: Enter в поле = нажать главную кнопку (у неё
 * type="submit"). Сама форма — flex-колонка, иначе тело перестаёт
 * прокручиваться. Браузерную валидацию отключаем: проверки — тостами в
 * обработчике, как во всей админке.
 */
const DialogForm = ({
  onSubmit,
  className,
  ...props
}: Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & { onSubmit: () => void }) => (
  <form
    noValidate
    className={cn("flex min-h-0 flex-1 flex-col", className)}
    onSubmit={(e) => {
      e.preventDefault();
      // React ведёт события по дереву компонентов, а не по DOM: submit формы
      // из вложенного окна (портал) иначе всплыл бы до формы внешнего окна и
      // отправил бы и её.
      e.stopPropagation();
      onSubmit();
    }}
    {...props}
  />
);
DialogForm.displayName = "DialogForm";

/**
 * Подвал с кнопками — тоже закреплён, всегда виден под прокруткой тела.
 * Порядок: слева при необходимости разрушающее действие («Удалить»), справа
 * «Отмена» (outline) и главная кнопка. Кнопки всегда в строку — на телефоне
 * они делят ширину поровну (столбиком две короткие кнопки только съедали
 * высоту формы).
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3 sm:px-6 sm:py-4 max-sm:[&>*]:flex-1",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogForm,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
