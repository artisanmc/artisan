import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/state/authStore";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const navigate = useNavigate();

  useEffect(() => {
    navigate({
      to: currentUser ? "/networks" : "/login",
    });
  }, [currentUser, navigate]);

  return null;
}
