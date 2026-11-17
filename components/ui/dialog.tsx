"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm" />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-white p-6 shadow-xl",
          className,
        )}
        {...props}
      >
        {children}
        <Primitive.Close
          className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full hover:bg-neutral-100"
          aria-label="Закрыть"
        >
          <X size={19} />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
export function DialogTitle(
  props: React.ComponentProps<typeof Primitive.Title>,
) {
  return (
    <Primitive.Title className="mb-3 pr-8 text-xl font-semibold" {...props} />
  );
}
export function DialogDescription(
  props: React.ComponentProps<typeof Primitive.Description>,
) {
  return (
    <Primitive.Description
      className="mb-5 text-sm leading-relaxed text-muted-foreground"
      {...props}
    />
  );
}
