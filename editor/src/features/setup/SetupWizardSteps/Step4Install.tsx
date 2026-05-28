import type { WizardState } from "../SetupWizard";

const WS_URL =
  import.meta.env.VITE_PLUGIN_WS_URL ?? "wss://editor.artisanmc.net/ws/plugin";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step4Install({ state }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Step 4: Install on your server</h2>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">1. Add this to your Artisan config.yml</h3>
        <pre className="bg-muted rounded px-4 py-3 text-sm font-mono whitespace-pre-wrap break-all">
{`server-key: "${state.serverKey ?? "<your-server-key>"}"
backend-url: "${WS_URL}"`}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">2. Your server key (save it safely)</h3>
        <code className="block bg-muted rounded px-3 py-2 font-mono text-sm break-all">
          {state.serverKey ?? "(no key generated)"}
        </code>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">3. Reload the plugin</h3>
        <pre className="bg-muted rounded px-4 py-2 text-sm font-mono">/artisan reload</pre>
        <p className="text-xs text-muted-foreground">
          Run this command in-game or from console. The plugin will connect to the backend and
          download your pack automatically.
        </p>
      </section>
    </div>
  );
}
