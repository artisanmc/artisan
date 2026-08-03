import { ForgotPasswordForm } from "@/features/auth/ForgotPasswordForm";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <ForgotPasswordForm apiUrl={apiUrl} />
    </div>
  );
}
