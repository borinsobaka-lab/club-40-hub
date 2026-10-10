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
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
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
      className={cn(
        "fixed left-[50%] top-[50%] z-50 flex max-h-[min(85vh,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
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
      "flex shrink-0 flex-col space-y-1.5 border-b px-4 py-4 sm:px-6 pr-12 text-left",
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
 * Подвал с кнопками — тоже закреплён, всегда виден под прокруткой тела.
 * Кнопки всегда в строку (и на телефоне — столбик из трёх кнопок съедал
 * треть экрана). Порядок: [опасное действие слева, `className="mr-auto"`] …
 * «Отмена» (outline) и основная кнопка справа.
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-4 sm:px-6",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

/**
 * Форма диалога: оборачивает шапку, тело и подвал, не ломая их раскладку.
 * Enter в поле отправляет форму (кнопка в подвале — `type="submit"`), как в
 * любой нормальной форме; браузерная валидация выключена — проверяем сами.
 */
const DialogForm = ({
  className,
  onSubmit,
  ...props
}: Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & { onSubmit: () => void }) => (
  <form
    noValidate
    className={cn("flex min-h-0 flex-1 flex-col", className)}
    onSubmit={(e) => {
      e.preventDefault();
      // Диалоги рендерятся в портале, но события React всплывают по дереву
      // компонентов: без этого отправка вложенного диалога (абонемент из
      // карточки клиента, открытой из формы занятия) отправила бы и внешнюю форму.
      e.stopPropagation();
      onSubmit();
    }}
    {...props}
  />
);
DialogForm.displayName = "DialogForm";

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
  DialogFooter,
  DialogForm,
  DialogTitle,
  DialogDescription,
};
