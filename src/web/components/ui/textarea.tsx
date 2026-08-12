import type * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[var(--radius-control)] border border-line bg-panel px-3 py-2 text-base text-ink shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted focus-visible:border-signal focus-visible:ring-[3px] focus-visible:ring-signal/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
