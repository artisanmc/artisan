import { Link } from "@tanstack/react-router";
import { listModules } from "../modules/api/registry";

export function ModuleSidebar() {
  const modules = listModules();
  return (
    <nav className="flex flex-col gap-1 p-2">
      {modules.map((m) => {
        const Icon = m.sidebar.icon;
        return (
          <Link
            key={m.id}
            to={m.sidebar.to}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <Icon className="size-4" />
            <span>{m.sidebar.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
