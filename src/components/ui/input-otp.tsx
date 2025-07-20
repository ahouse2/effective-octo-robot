"use client";

import * as React from "react";
import { OTPInput, Slot, type SlotProps } from "input-otp";
import { Dot } from "lucide-react";

import { cn } from "@/lib/utils";

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName,
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

const InputOTPSlot = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot> & { index: number }
>(({ index, className, ...props }, ref) => (
  <Slot
    ref={ref}
    index={index}
    className={cn(
      "relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm shadow-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
      "focus-within:z-10 focus-within:ring-1 focus-within:ring-ring",
      className,
    )}
    {...props}
  >
    {({ isActive, char }: SlotProps & { isActive: boolean; char: string }) => ( // Explicitly define isActive and char
      <React.Fragment>
        {char}
        {isActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
          </div>
        )}
      </React.Fragment>
    )}
  </Slot>
));
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPDot = React.forwardRef<
  React.ElementRef<typeof Dot>,
  React.ComponentPropsWithoutRef<typeof Dot>
>(({ className, ...props }, ref) => (
  <Dot
    ref={ref}
    className={cn("h-2 w-2", className)}
    {...props}
  />
));
InputOTPDot.displayName = "InputOTPDot";

export { InputOTP, InputOTPSlot, InputOTPDot };