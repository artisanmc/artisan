import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)] font-mono text-xs rounded-[14px]",
          error: "border-[var(--danger-soft)] text-[var(--danger)]",
          success: "border-[var(--success-soft)] text-[var(--success)]",
          info: "border-[var(--border)] text-[var(--text)]",
          warning: "border-[var(--warning-soft)] text-[var(--warning)]",
        },
      }}
    />
  );
}
