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
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignupForm apiUrl={apiUrl} onSuccess={handleSignupSuccess} />
    </div>
  );
}
