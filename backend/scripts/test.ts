import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
/** Migrate the dedicated test database once; full runs use one process per file. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { assertTestDatabaseName, testProcesses } from "./testPlan";
const ADMIN_URL =
	process.env.ADMIN_DATABASE_URL ??
	"postgresql://postgres:postgres@localhost:5432/postgres";
const TEST_DB = process.env.TEST_DATABASE_NAME ?? "artisan_test";
assertTestDatabaseName(TEST_DB);
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
const env = { ...process.env, DATABASE_URL: TEST_URL };
const admin = postgres(ADMIN_URL);
try {
	if (
		!(await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`).length
	)
		await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
} finally {
	await admin.end();
}
console.log(
	`[test] Bun ${Bun.version}: ${process.execPath}; database ${TEST_DB}`,
);
const migration = spawnSync(process.execPath, ["run", "src/db/migrate.ts"], {
	env,
	stdio: "inherit",
});
if (migration.status !== 0) process.exit(migration.status ?? 1);
const args = process.argv.slice(2);
const files = args.length
	? []
	: [...new Bun.Glob("**/*.{test,spec}.{ts,tsx,js,jsx}").scanSync(".")].filter(
			(file) =>
				!file
					.split(/[\\/]/)
					.some((part) =>
						["node_modules", "dist", "build", ".scratch", ".git"].includes(
							part,
						),
					),
		);
const commands = testProcesses(args, files);
if (!commands.length) throw new Error("no_test_files");
const logs = mkdtempSync(join(tmpdir(), "artisan-test-results-"));
const sql = postgres(TEST_URL);
let failed = 0;
const totals = { pass: 0, fail: 0, skip: 0, todo: 0 };
try {
	for (const [index, command] of commands.entries()) {
		if (!args.length) {
			const [identity] = await sql`SELECT current_database() AS name`;
			if (identity?.name !== TEST_DB) throw new Error("unsafe_test_database");
			const tables =
				await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
			if (tables.length)
				await sql.unsafe(
					`TRUNCATE ${tables.map(({ tablename }) => `public."${String(tablename).replaceAll('"', '""')}"`).join(",")} RESTART IDENTITY CASCADE`,
				);
		}
		const cache = mkdtempSync(join(tmpdir(), "artisan-test-cache-"));
		try {
			const result = spawnSync(process.execPath, command, {
				env: { ...env, ASSET_CACHE_DIR: cache },
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				timeout: 180_000,
			});
			const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error}` : ""}`;
			writeFileSync(join(logs, `${index + 1}.log`), output);
			for (const key of Object.keys(totals) as (keyof typeof totals)[])
				totals[key] += Number(
					output.match(new RegExp(`(?:^|\\n)\\s*(\\d+) ${key}\\b`))?.[1] ?? 0,
				);
			if (result.status !== 0) failed++;
			console.log(
				`[test] ${index + 1}/${commands.length} ${result.status === 0 ? "PASS" : "FAIL"} ${command.slice(1).join(" ")}`,
			);
			if (args.length || result.status !== 0) console.log(output);
		} finally {
			rmSync(cache, { recursive: true, force: true });
		}
	}
} finally {
	await sql.end();
}
console.log(
	`[test] ${commands.length} processes; ${failed} failed; ${JSON.stringify(totals)}; logs ${logs}`,
);
process.exit(failed ? 1 : 0);
