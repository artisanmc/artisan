import { useAuthStore } from "@/state/authStore";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { DEMO_AUTH_RETURN } from "./demoLifecycle";
export function DemoAuthReturn() {
  const user = useAuthStore((s) => s.currentUser);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  useEffect(() => {
    const next = sessionStorage.getItem(DEMO_AUTH_RETURN);
    if (!user || pathname !== "/account" || !next || !/^\/demo\/projects\/[^/?#]+$/.test(next))
      return;
    void navigate({
      to: "/demo/projects/$projectId",
      params: { projectId: decodeURIComponent(next.slice("/demo/projects/".length)) },
    });
  }, [user, pathname, navigate]);
  return null;
}
