import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import type { ReactNode } from "react";

/** Shared shell of every auth screen: branded card + page title. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card relative z-[1] mx-auto flex w-full max-w-[400px] flex-col gap-5 p-8">
      <div className="flex items-center gap-1">
        <ArtisanWordmark />
      </div>

      <h1
        className="display text-[28px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h1>

      {children}
    </div>
  );
}
