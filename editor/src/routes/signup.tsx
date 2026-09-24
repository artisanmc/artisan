import { SignupForm } from "@/features/auth/SignupForm";
import { safeAuthReturn } from "@/lib/authReturn";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/signup")({
  beforeLoad: ({ search }) => {
    // Already-authenticated users have no business on /signup. Bounce them to
    // their requested `?next=` target (if safe) or to /account.
    const user = useAuthStore.getState().currentUser;
    if (user) {
      const next = (search as { next?: string } | undefined)?.next;
      const safeNext = safeAuthReturn(next);
      throw redirect({ to: safeNext });
    }
  },
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  function handleSignupSuccess() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext = safeAuthReturn(next);
    navigate({ to: safeNext });
  }

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <SignupForm apiUrl={apiUrl} onSuccess={handleSignupSuccess} />
    </div>
  );
}
