interface TrustBannerProps {
  trustCode: string;
}

export function TrustBanner({ trustCode }: TrustBannerProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-sm text-amber-300">
      <span className="font-semibold">Deploy désactivé.</span>
      <span>
        Tapez en jeu :{" "}
        <code className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-amber-200">
          /artisan trusteditor {trustCode}
        </code>
      </span>
    </div>
  );
}
