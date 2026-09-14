export interface ProjectUrlIdentity {
  id: string;
  externalId?: string | null;
  diskId?: string | null;
}

/** Exact folder/module ID; never normalize case or punctuation. */
export function projectUrlId(project: ProjectUrlIdentity): string {
  return project.externalId ?? project.diskId ?? project.id;
}
