import { LoginForm } from "@/features/auth/LoginForm";
import { SelfHostedSignIn } from "@/features/selfHosted/SelfHostedSignIn";
import { safeAuthReturn } from "@/lib/authReturn";
import { SELF_HOSTED } from "@/lib/selfHosted";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ search }) => {
    // Already-authenticated users have no business on /login. Bounce them to
    // their requested `?next=` target (if safe) or to /account.
    const user = useAuthStore.getState().currentUser;
    if (user) {
      const next = (search as { next?: string } | undefined)?.next;
      const safeNext = safeAuthReturn(next);
      throw redirect({ to: safeNext });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  function handleLoginSuccess() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext = safeAuthReturn(next);
    navigate({ to: safeNext });
  }

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      {SELF_HOSTED ? (
        <SelfHostedSignIn expired={new URLSearchParams(window.location.search).has("expired")} />
      ) : (
        <LoginForm apiUrl={apiUrl} onSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}
