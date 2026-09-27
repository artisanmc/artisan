import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export function ProjectStaleNotice({ offline, since }: { offline: boolean; since?: string | null }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const detailsId = useId();
  return (
    <div className="flex items-center justify-center gap-1 px-2 py-1">
      <span className="chip min-w-0 px-2.5 text-[11px]">
        {collapsed && t(offline ? "project.offlineTitle" : "project.staleChecking")}
        <span id={detailsId} hidden={collapsed}>
          {since
            ? t("project.staleOfflineSince", { date: new Date(since).toLocaleString() })
            : t(offline ? "project.staleOffline" : "project.staleLoading")}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        aria-label={t(collapsed ? "project.expandNotice" : "project.collapseNotice")}
        aria-expanded={!collapsed}
        aria-controls={detailsId}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
      </Button>
    </div>
  );
}
