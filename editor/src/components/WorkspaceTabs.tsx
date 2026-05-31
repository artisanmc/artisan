export interface WorkspaceTab {
  id: string;
  label: string;
  badge?: number;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function WorkspaceTabs({ tabs, activeTab, onChange }: WorkspaceTabsProps) {
  return (
    <div
      role="tablist"
      className="flex h-[44px] shrink-0 items-center gap-1 border-b border-[var(--line-soft)] bg-[var(--bg)] px-3.5"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(tab.id)}
            className={`tab ${isActive ? "is-active" : ""}`}
          >
            <span>{tab.label}</span>
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span className="badge badge-amber">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
