import { ResetPasswordForm } from "@/features/auth/ResetPasswordForm";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <ResetPasswordForm apiUrl={apiUrl} token={token} />
    </div>
  );
}
