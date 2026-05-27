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
    <div role="tablist" className="flex border-b border-zinc-800 bg-zinc-950 px-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(tab.id)}
            className={
              isActive
                ? "flex items-center gap-2 border-b-2 border-blue-500 px-4 py-2 text-sm text-zinc-100"
                : "flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            }
          >
            <span>{tab.label}</span>
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
