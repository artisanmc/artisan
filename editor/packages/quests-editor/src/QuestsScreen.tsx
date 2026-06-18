import { Button } from "@artisan/editor-sdk";

export function QuestsScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Quests</h1>
      <p className="text-[var(--text-mut)]">
        Tracer-bullet module loaded from <code>@artisan/quests-editor</code>.
      </p>
      <Button variant="primary">A base-component button from the SDK</Button>
    </div>
  );
}
