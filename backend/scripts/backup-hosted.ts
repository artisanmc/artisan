import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { projects } from "../src/db/schema";
import { durableWrite, safeTree, syncTree } from "../src/lib/storage/hostedFilesystem";

// Run with the same DATABASE_URL / HOSTED_PROJECTS_DIR as the backend.
const destination = process.argv[2];
if (!destination)
  throw new Error(
    "Usage: bun run scripts/backup-hosted.ts <new-backup-directory> [--docker <postgres-container>]",
  );
const container = process.argv[3] === "--docker" ? process.argv[4] : undefined;
if (process.argv[3] && !container) throw new Error("Invalid backup arguments");
const target = resolve(destination);
const volume = resolve(process.env.HOSTED_PROJECTS_DIR ?? "data/hosted-projects");
if (target === volume || target.startsWith(volume + sep) || volume.startsWith(target + sep))
  throw new Error("Backup must be outside the hosted volume");
await mkdir(target, { recursive: false });
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hosted-maintenance'))`);
    const roots = (
      await tx
        .select({ id: projects.hostedRootId })
        .from(projects)
        .where(eq(projects.storageKind, "hosted"))
    )
      .flatMap((p) => (p.id ? [p.id] : []))
      .sort();
    for (const id of roots)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hosted:${id}`}))`);
    const snapshot = await tx.execute(sql`select pg_export_snapshot() as snapshot`);
    const token = String(snapshot[0]!.snapshot);
    const database = new URL(
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/artisan",
    );
    // A libpq service file preserves URI options without credentials in argv.
    const parameters: Record<string, string> = {
      host: database.hostname,
      port: database.port || "5432",
      user: decodeURIComponent(database.username),
      password: decodeURIComponent(database.password),
      dbname: decodeURIComponent(database.pathname.slice(1)),
      ...Object.fromEntries(database.searchParams),
    };
    if (
      Object.entries(parameters).some(
        ([key, value]) => !/^[a-z_]+$/.test(key) || /[\r\n]/.test(value),
      )
    )
      throw new Error("Unsupported database connection option");
    const service = `[artisan_backup]\n${Object.entries(parameters)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`;
    const secrets = await mkdtemp(join(tmpdir(), "artisan-pg-service-"));
    try {
      const servicePath = join(secrets, "pg_service.conf");
      await writeFile(servicePath, service, { mode: 0o600 });
      const env = {
        ...process.env,
        PGSERVICEFILE: servicePath,
        PGSERVICE: "artisan_backup",
      };
      const command = container
        ? [
            "docker",
            "exec",
            "-i",
            container,
            "sh",
            "-c",
            'file=$(mktemp); chmod 600 "$file"; trap \'rm -f "$file"\' EXIT; cat > "$file"; PGSERVICEFILE="$file" PGSERVICE=artisan_backup pg_dump --format=custom --snapshot="$1"',
            "sh",
            token,
          ]
        : [
            process.env.PG_DUMP_BIN ?? "pg_dump",
            "--format=custom",
            `--snapshot=${token}`,
            `--file=${join(target, "database.dump")}`,
          ];
      const child = Bun.spawn(command, {
        env,
        stdin: container ? Bun.file(servicePath) : "ignore",
        stdout: container ? Bun.file(join(target, "database.dump")) : "inherit",
        stderr: "inherit",
      });
      if ((await child.exited) !== 0) throw new Error("pg_dump failed; backup is incomplete");
    } finally {
      await rm(secrets, { recursive: true, force: true });
    }
    await safeTree(volume);
    await cp(volume, join(target, "hosted-projects"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await syncTree(join(target, "hosted-projects"));
    await durableWrite(
      join(target, "backup.json"),
      JSON.stringify(
        {
          schema: "artisan-hosted-backup/v1",
          createdAt: new Date().toISOString(),
          roots,
          database: "database.dump",
          volume: "hosted-projects",
        },
        null,
        2,
      ),
    );
  });
  console.log(`Backup set written to ${target}`);
  process.exit(0);
} catch (error) {
  console.error("Incomplete backup: do not restore without backup.json", error);
  process.exit(1);
}
