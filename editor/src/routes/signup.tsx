import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SignupForm } from "@/features/auth/SignupForm";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  function handleSignupSuccess() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    navigate({ to: safeNext });
  }

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--bg)] p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(223,107,65,.06), transparent 60%)",
        }}
      />
      <SignupForm apiUrl={apiUrl} onSuccess={handleSignupSuccess} />
    </div>
  );
}
