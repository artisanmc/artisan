import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SignupForm } from "@/features/auth/SignupForm";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignupForm apiUrl={apiUrl} onSuccess={() => navigate({ to: "/account" })} />
    </div>
  );
}
