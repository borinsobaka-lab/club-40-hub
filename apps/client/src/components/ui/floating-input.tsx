import * as React from "react";

import { cn } from "@/lib/utils";

/* ───────── Floating label input ───────── */
interface FloatingLabelInputProps extends React.ComponentProps<"input"> {
  label: string;
}

const FloatingLabelInput = React.forwardRef<
  HTMLInputElement,
  FloatingLabelInputProps
>(({ className, label, onFocus, onBlur, value, ...props }, ref) => {
  const [focused, setFocused] = React.useState(false);
  const hasValue = String(value ?? "").length > 0;
  const active = focused || hasValue;

  return (
    <div className="relative">
      <input
        ref={ref}
        value={value}
        className={cn(
          "flex h-14 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-none transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          active ? "pt-5 pb-1" : "py-1",
          className,
        )}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
      <label
        className={cn(
          "absolute left-3 pointer-events-none transition-all duration-200 origin-left",
          active
            ? "top-1.5 text-[11px] text-muted-foreground"
            : "top-1/2 -translate-y-1/2 text-base text-muted-foreground",
        )}
      >
        {label}
      </label>
    </div>
  );
});
FloatingLabelInput.displayName = "FloatingLabelInput";

/* ───────── Floating label select ───────── */
interface FloatingLabelSelectProps {
  label: string;
  value?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

const FloatingLabelSelect = React.forwardRef<
  HTMLButtonElement,
  FloatingLabelSelectProps
>(({ label, value, onValueChange, placeholder, children, disabled, className }, ref) => {
  const [focused, setFocused] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const hasValue = !!value && value !== "unset";
  const active = focused || open || hasValue;

  return (
    <div className={cn("relative", className)}>
      {/* We re-render Radix Select so open state is tracked */}
      <SelectRootWrapper
        value={value}
        onValueChange={onValueChange}
        onOpenChange={setOpen}
        focused={focused}
        setFocused={setFocused}
        ref={ref}
        placeholder={placeholder}
        disabled={disabled}
        active={active}
      >
        {children}
      </SelectRootWrapper>
      <span
        className={cn(
          "absolute left-3 pointer-events-none transition-all duration-200 origin-left",
          active
            ? "top-1.5 text-[11px] text-muted-foreground"
            : "top-1/2 -translate-y-1/2 text-base text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
});
FloatingLabelSelect.displayName = "FloatingLabelSelect";

/* Internal helper that bridges Radix Select with focus tracking */
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
} from "@/components/ui/select";

interface SelectRootWrapperProps {
  value?: string;
  onValueChange?: (v: string) => void;
  onOpenChange: (open: boolean) => void;
  focused: boolean;
  setFocused: (v: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  active: boolean;
  children?: React.ReactNode;
}

const SelectRootWrapper = React.forwardRef<
  HTMLButtonElement,
  SelectRootWrapperProps
>(
  (
    {
      value,
      onValueChange,
      onOpenChange,
      setFocused,
      placeholder,
      disabled,
      active,
      children,
    },
    ref,
  ) => {
    return (
      <Select
        value={value}
        onValueChange={onValueChange}
        onOpenChange={onOpenChange}
        disabled={disabled}
      >
        <SelectTrigger
          ref={ref}
          className={cn(
            "flex h-14 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 shadow-none ring-offset-background cursor-pointer",
            "data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            active ? "pt-5 pb-1" : "py-1",
          )}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <SelectValue placeholder={active ? undefined : placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    );
  },
);
SelectRootWrapper.displayName = "SelectRootWrapper";

export { FloatingLabelInput, FloatingLabelSelect };
