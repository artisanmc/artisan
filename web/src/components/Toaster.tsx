import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "border border-zinc-800 bg-zinc-950 text-zinc-100 font-mono text-xs",
          error: "border-red-900 text-red-200",
          success: "border-emerald-900 text-emerald-200",
        },
      }}
    />
  );
}
