import { lstat, readdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { deletedDraftOwners, projectRenames, projects } from "../../db/schema";
import { HostedProjectStorage, hostedStorageOptions } from "./HostedProjectStorage";
import { HostedFilesystem, safeTree } from "./hostedFilesystem";
import { openHostedProjectStorage } from "./hostedProjects";
import { storageTransaction } from "./storageTransaction";
import { maintainDemoSessions } from "../demoSessions";

/** SQL tombstones are observed after commit. A single unavailable root never blocks other purges. */
export async function maintainHostedProjects(now = Date.now()) {
  const demoErrors = await maintainDemoSessions();
  const volume = resolve(process.env.HOSTED_PROJECTS_DIR ?? "data/hosted-projects");
  try {
    if ((await lstat(volume)).isSymbolicLink()) throw new Error("unsafe_storage_path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const errors: { rootId: string; error: unknown }[] = [...demoErrors];
  await storageTransaction(async (tx) => {
    // Creation takes this before opening any root; an uncommitted creation can never look abandoned.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hosted-maintenance'))`);
    const anchors = await tx.select().from(projects).where(eq(projects.storageKind, "hosted"));
    const owners = (await tx.select().from(deletedDraftOwners)).map((o) => o.ownerId);
    for (const project of anchors) {
      if (project.demoSessionId) continue;
      if (!project.hostedRootId) continue;
      try {
        try {
          await lstat(resolve(volume, project.hostedRootId));
        } catch (error) {
          if (project.deletedAt && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const pending = (
          await tx.select().from(projectRenames).where(eq(projectRenames.projectId, project.id))
        ).filter((o) => o.status === "pending");
        if (pending.length && !project.deletedAt) {
          const storage = await openHostedProjectStorage(project, "maintenance");
          for (const operation of pending) await storage.rename(operation.id, operation.targetId);
        }
        const storage = await HostedProjectStorage.open(
          hostedStorageOptions(project, "maintenance"),
        );
        if (owners.length) await storage.purgeOwners(owners);
        await storage.filesystem.locked(async () => {
          const current = await storage.filesystem.current();
          if (project.deletedAt && !current.state.deleted)
            await storage.filesystem.commit(current, async (next) => {
              next.state.deleted = true;
            });
          // Persist expiry of response bodies, retaining non-replayable operation fingerprints.
          if (
            Object.values(current.state.receipts).some((r) => r.result && r.at < now - 86_400_000)
          )
            await storage.filesystem.commit(await storage.filesystem.current(), async () => {});
          await storage.filesystem.collect();
        });
      } catch (error) {
        errors.push({ rootId: project.hostedRootId, error });
      }
    }
    const known = new Map(anchors.filter((p) => p.hostedRootId).map((p) => [p.hostedRootId!, p]));
    for (const name of await readdir(volume)) {
      // Only this lifecycle's generated containers are collectible. Never infer ownership of arbitrary folders.
      if (!/^(hosted|demo)_[a-f0-9]{32}$/.test(name)) continue;
      const path = resolve(volume, name);
      if (!path.startsWith(volume + sep)) throw new Error("unsafe_storage_path");
      const anchor = known.get(name);
      const stat = await lstat(path);
      if (
        (anchor && !anchor.deletedAt) ||
        (anchor?.deletedAt && now - anchor.deletedAt.getTime() < 30 * 86_400_000) ||
        (!anchor && now - stat.mtimeMs < 86_400_000)
      )
        continue;
      try {
        await new HostedFilesystem(volume, name).locked(async () => {
          const fresh = (
            await tx.select().from(projects).where(eq(projects.hostedRootId, name))
          )[0];
          if (
            (fresh && !fresh.deletedAt) ||
            (fresh?.deletedAt && now - fresh.deletedAt.getTime() < 30 * 86_400_000)
          )
            return;
          await safeTree(path);
          await rm(path, { recursive: true });
        });
      } catch (error) {
        errors.push({ rootId: name, error });
      }
    }
  });
  if (errors.length)
    throw new AggregateError(
      errors.map((e) => e.error),
      `hosted maintenance failed for ${errors.map((e) => e.rootId).join(", ")}`,
    );
}
