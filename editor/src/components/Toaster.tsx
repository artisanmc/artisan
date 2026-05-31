import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-[var(--line)] bg-[var(--card-surface)] text-[var(--ink)] font-mono text-xs rounded-[14px]",
          error: "border-[var(--brick-soft)] text-[var(--brick)]",
          success: "border-[var(--sage-soft)] text-[var(--sage)]",
          info: "border-[var(--line)] text-[var(--ink)]",
          warning: "border-[var(--gold-soft)] text-[var(--gold)]",
        },
      }}
    />
  );
}
