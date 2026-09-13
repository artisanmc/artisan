import type { ProjectSummary } from "./networks";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export type HostedProjectInput = {
  operationId: string;
  name: string;
  folderName: string;
  minecraftVersion: string;
  templateId: "vanilla";
};
export class HostedProjectError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function hostedTemplates(
  networkId: string,
): Promise<{ templates: { id: string }[]; minecraftVersions: string[] }> {
  const response = await fetch(
    `${API_URL}/api/v1/networks/${encodeURIComponent(networkId)}/hosted-projects/templates`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("templates_unavailable");
  return response.json();
}
export async function listHostedProjects(networkId: string): Promise<ProjectSummary[]> {
  const response = await fetch(
    `${API_URL}/api/v1/networks/${encodeURIComponent(networkId)}/hosted-projects`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("hosted_projects_unavailable");
  return (await response.json()).projects;
}
export async function createHostedProject(
  networkId: string,
  input: HostedProjectInput,
): Promise<ProjectSummary> {
  const response = await fetch(
    `${API_URL}/api/v1/networks/${encodeURIComponent(networkId)}/hosted-projects`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = await response.json();
  if (!response.ok)
    throw new HostedProjectError(body.error ?? "hosted_creation_failed", response.status);
  return body.project;
}
