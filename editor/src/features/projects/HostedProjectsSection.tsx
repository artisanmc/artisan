import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { importHostedProject } from "@/features/export/importHostedProject";
import { pickProjectZipForImport } from "@/features/export/runImportZip";
import { useProjectZipImport } from "@/features/export/useProjectZipImport";
import {
  HostedProjectError,
  type HostedProjectInput,
  createHostedProject,
  hostedTemplates,
  listHostedProjects,
} from "@/lib/api/hostedProjects";
import type { ProjectSummary } from "@/lib/api/networks";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { projectDestination } from "@/lib/projectNavigation";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function HostedProjectsSection({ networkId }: { networkId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fieldId = useId();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [version, setVersion] = useState("1.21.4");
  const [versions, setVersions] = useState<string[]>([]);
  const ownerId = useAuthStore((state) => state.currentUser?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<HostedProjectInput | null>(null);
  const importer = useProjectZipImport({
    destinationDescription: t("hosted.importDescription", {
      defaultValue:
        "Import as a new hosted project in this Network using Minecraft {{version}}. Choose its folder name. Images and fonts are included.",
      version,
    }),
    importProject: () => {
      throw new Error("storage_required");
    },
    persistImport: (file, target) =>
      ownerId
        ? importHostedProject(file, networkId, version, ownerId, target)
        : Promise.reject(new Error("not_authenticated")),
    onImported: ({ newId }) => {
      useNetworksStore.getState().bumpRefresh();
      void navigate(projectDestination(networkId, newId));
    },
    onError: (failure) => setError(failure.message),
  });
  useEffect(() => {
    let cancelled = false;
    void hostedTemplates(networkId)
      .then((catalog) => {
        if (!cancelled) {
          setVersions(catalog.minecraftVersions);
          setVersion(
            catalog.minecraftVersions.includes("1.21.4")
              ? "1.21.4"
              : (catalog.minecraftVersions[0] ?? ""),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [networkId]);
  useEffect(() => {
    let cancelled = false;
    setProjects([]);
    void listHostedProjects(networkId)
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch(() => {
        if (!cancelled) setError("hosted_projects_unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [networkId]);
  async function create() {
    setBusy(true);
    setError(null);
    const input = pending.current ?? {
      operationId: crypto.randomUUID(),
      name: name.trim(),
      folderName: folderName.trim(),
      minecraftVersion: version.trim(),
      templateId: "vanilla" as const,
    };
    pending.current = input;
    try {
      const project = await createHostedProject(networkId, input);
      pending.current = null;
      setProjects((previous) => [...previous.filter((item) => item.id !== project.id), project]);
      useNetworksStore.getState().bumpRefresh();
      setOpen(false);
      void navigate(projectDestination(networkId, project.id));
    } catch (failure) {
      if (
        failure instanceof HostedProjectError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408
      )
        pending.current = null;
      setError(failure instanceof Error ? failure.message : "hosted_creation_failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t("hosted.title", { defaultValue: "Hosted projects" })}
    >
      {importer.dialog}
      <Button
        variant="secondary"
        onClick={() =>
          pickProjectZipForImport((file) => {
            void importer.importFile(file);
          })
        }
      >
        {t("hosted.import", { defaultValue: "Import ZIP" })}
      </Button>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {t("hosted.title", { defaultValue: "Hosted projects" })}
        </h2>
        <Button onClick={() => setOpen(true)}>
          {t("hosted.create", { defaultValue: "Create without a server" })}
        </Button>
      </div>
      <p className="text-sm text-[var(--text-mut)]">
        {t("hosted.description", {
          defaultValue:
            "Create and preview projects here. Connect Minecraft when you are ready to use them in game.",
        })}
      </p>
      {error && !open && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {projects.map((project) => (
        <Link
          key={project.id}
          {...projectDestination(networkId, project.id)}
          className="card p-4 text-sm hover:bg-[var(--surface-hover)]"
        >
          {project.name}
        </Link>
      ))}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {t("hosted.create", { defaultValue: "Create without a server" })}
          </DialogTitle>
          <DialogDescription>
            {t("hosted.createDescription", {
              defaultValue:
                "Files and private drafts are stored by Artisan. No Minecraft server is required.",
            })}
          </DialogDescription>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label htmlFor={`${fieldId}-name`} className="field-label flex flex-col gap-2">
              {t("hosted.name", { defaultValue: "Project name" })}
              <Input
                id={`${fieldId}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy || pending.current !== null}
                required
              />
            </label>
            <label htmlFor={`${fieldId}-folder`} className="field-label flex flex-col gap-2">
              {t("projectIdentity.folder", { defaultValue: "Project folder" })}
              <Input
                id={`${fieldId}-folder`}
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                disabled={busy || pending.current !== null}
                required
              />
            </label>
            <label htmlFor={`${fieldId}-version`} className="field-label flex flex-col gap-2">
              {t("hosted.minecraftVersion", { defaultValue: "Minecraft version" })}
              {versions.length ? (
                <select
                  id={`${fieldId}-version`}
                  className="input"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  disabled={busy || pending.current !== null}
                >
                  {versions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${fieldId}-version`}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  disabled={busy || pending.current !== null}
                  required
                />
              )}
            </label>
            <label className="field-label flex flex-col gap-2">
              {t("hosted.template", { defaultValue: "Template" })}
              <select className="input" value="vanilla" disabled>
                <option value="vanilla">Vanilla</option>
              </select>
            </label>
            {error && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                !name.trim() ||
                !isValidProjectFolderName(folderName.trim()) ||
                !version.trim()
              }
            >
              {busy
                ? t("common.loading", { defaultValue: "Creating…" })
                : t("hosted.create", { defaultValue: "Create without a server" })}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
