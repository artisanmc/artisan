import { expect, test } from "bun:test";
import postgres from "postgres";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "../../db";
import { networks, users, memberships, projects, demoSessions } from "../../db/schema";
import { createDemoSession, claimDemoSession } from "../demoSessions";
import { eq } from "drizzle-orm";
import {
	createHostedProject,
	openHostedProjectStorage,
} from "./hostedProjects";
import { HostedProjectStorage } from "./HostedProjectStorage";

const container = process.env.HOSTED_BACKUP_DOCKER;
test.skipIf(!container)(
	"backup CLI exports a real consistent SQL dump and restores its complete hosted volume",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "artisan-backup-contract-"));
		const prior = process.env.HOSTED_PROJECTS_DIR;
		process.env.HOSTED_PROJECTS_DIR = join(temporary, "volume");
		const restoreName =
			"artisan_test_restore_" +
			crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const sourceUrl = new URL(process.env.DATABASE_URL!);
		const adminUrl = new URL(sourceUrl);
		adminUrl.pathname = "/postgres";
		const admin = postgres(adminUrl.toString());
		let restored: ReturnType<typeof postgres> | undefined;
		let created = false;
    const demoIds:string[]=[];
		try {
			const now = new Date();
			const networkId = "backup-" + crypto.randomUUID();
			await db
				.insert(networks)
				.values({
					id: networkId,
					name: "Backup",
					createdAt: now,
					updatedAt: now,
				});
			const project = await createHostedProject({
				networkId,
				folderName: "backup",
				name: "Backup",
				minecraftVersion: "1.21.4",
				ownerId: "owner",
				operationId: "create",
			});
			const storage = await openHostedProjectStorage(project, "owner");
			await storage.write({
				files: [
					{ path: "menu.yaml", content: "restored: true", base_hash: null },
				],
				binaries: [
					{
						path: "textures/a.png",
						content: new Uint8Array([0, 255, 128]),
						baseHash: null,
					},
				],
			});
			await storage.drafts.create("private", "draft", {
				name: "Private",
				snapshot: { tree: {}, baseline: {}, at: 1 },
			});
      const activeDemo=await createDemoSession({rateKey:crypto.randomUUID()});
      const claimedDemo=await createDemoSession({rateKey:crypto.randomUUID()});
      demoIds.push(activeDemo.projectId,claimedDemo.projectId);
      const demoOwner=`backup-user-${crypto.randomUUID()}`;
      await db.insert(users).values({id:demoOwner,email:`${demoOwner}@example.test`,name:"Backup",createdAt:now,updatedAt:now});
      await db.insert(memberships).values({id:crypto.randomUUID(),userId:demoOwner,networkId,role:"owner",createdAt:now});
      await claimDemoSession(claimedDemo.token,demoOwner,{operationId:"backup-claim",networkId});
			const destination = join(temporary, "backup");
			const child = Bun.spawn(
				[
					process.execPath,
					"run",
					"scripts/backup-hosted.ts",
					destination,
					"--docker",
					container!,
				],
				{
					cwd: join(import.meta.dir, "../../.."),
					env: process.env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(child.stdout).text();
			const errors = await new Response(child.stderr).text();
			if ((await child.exited) !== 0) throw new Error(output + errors);
			expect(
				JSON.parse(await readFile(join(destination, "backup.json"), "utf8"))
					.schema,
			).toBe("artisan-hosted-backup/v1");
			if (!/^artisan_test_restore_[a-f0-9]{12}$/.test(restoreName))
				throw new Error("unsafe_test_database");
			await admin.unsafe(`CREATE DATABASE "${restoreName}"`);
			created = true;
			const restoredUrl = new URL(sourceUrl);
			restoredUrl.pathname = "/" + restoreName;
			const restore = Bun.spawn(
				[
					"docker",
					"exec",
					"-i",
					"--user",
					"postgres",
					container!,
					"pg_restore",
					"--exit-on-error",
					"--no-owner",
					"--dbname=" + restoredUrl.pathname.slice(1),
				],
				{
					env: process.env,
					stdin: Bun.file(join(destination, "database.dump")),
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const restoreErrors = await new Response(restore.stderr).text();
			if ((await restore.exited) !== 0) throw new Error(restoreErrors);
			restored = postgres(restoredUrl.toString());
			const rows =
				await restored`select id, hosted_root_id, external_id, hosted_minecraft_version from projects where id=${project.id}`;
			expect(rows[0]?.hosted_minecraft_version).toBe("1.21.4");
			const copy = await HostedProjectStorage.open({
				volumeRoot: join(destination, "hosted-projects"),
				rootId: rows[0]!.hosted_root_id,
				folderName: rows[0]!.external_id,
				projectId: rows[0]!.id,
				ownerId: "owner",
			});
			expect(await copy.readBinary("textures/a.png")).toMatchObject({
				result: { content: new Uint8Array([0, 255, 128]) },
			});
			expect(await copy.drafts.read("private")).toMatchObject({
				result: { draft: { ownerId: "owner" } },
			});
      for (const demoId of demoIds) {
        const demoRows=await restored`select p.id,p.network_id,p.demo_session_id,p.hosted_root_id,p.external_id,s.state from projects p join demo_sessions s on s.project_id=p.id where p.id=${demoId}`;
        expect(demoRows[0]?.state).toBe(demoId===activeDemo.projectId?"active":"claimed");
        expect(demoRows[0]?.network_id).toBe(demoId===activeDemo.projectId?null:networkId);
        const restoredDemo=await HostedProjectStorage.open({volumeRoot:join(destination,"hosted-projects"),rootId:demoRows[0]!.hosted_root_id,folderName:demoRows[0]!.external_id,projectId:demoId,ownerId:demoOwner});
        const read=await restoredDemo.read();
        expect(read.kind==="result" && "files" in read.result && read.result.files.some(f=>f.path==="menus/welcome.yaml")).toBe(true);
      }
		} finally {
			await restored?.end();
			if (created) await admin.unsafe(`DROP DATABASE "${restoreName}"`);
			await admin.end();
      for(const id of demoIds){await db.delete(projects).where(eq(projects.id,id));await db.delete(demoSessions).where(eq(demoSessions.projectId,id));}
			if (prior === undefined) delete process.env.HOSTED_PROJECTS_DIR;
			else process.env.HOSTED_PROJECTS_DIR = prior;
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
