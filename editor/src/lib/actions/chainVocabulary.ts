import type { DeclaredAction } from "@/lib/api/declaredActions";
import { createContext, useContext } from "react";

/**
 * The actions of a step tree that is not an action chain: the display rules of a module's
 * variants (`show_variant`, `show_default`), edited with the chains' `StepTree`. Set around
 * the tree, it replaces the step picker's actions (no core, module or event action) and is
 * looked up first for an action's form and label.
 */
export interface ChainVocabulary {
  actions: DeclaredAction[];
  /** The name a person reads for one of [actions]. */
  label: (name: string) => string;
}

const ChainVocabularyContext = createContext<ChainVocabulary | null>(null);
export const ChainVocabularyProvider = ChainVocabularyContext.Provider;
export const useChainVocabulary = (): ChainVocabulary | null => useContext(ChainVocabularyContext);
