import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">Interfaze Editor</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        Pour accéder à l'éditeur, lancez cette commande sur votre serveur Minecraft :
      </p>
      <code className="rounded bg-muted px-4 py-3 text-lg font-bold tracking-wider">
        /ifz editor
      </code>
      <p className="text-muted-foreground max-w-sm text-xs">
        Un lien temporaire vous sera envoyé dans le chat. Il expire après 30 minutes d'inactivité.
      </p>
    </div>
  );
}
