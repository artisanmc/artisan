import type { ProjectId } from "@/domain/types";
import { createContext } from "react";

export const ResolvedProjectContext = createContext<ProjectId | null>(null);
