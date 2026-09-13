import { expect, test } from "bun:test";
import { assertTestDatabaseName, testProcesses } from "./testPlan";

test("full runs isolate every file and targeted arguments stay unchanged", () => {
	expect(testProcesses([], ["src/b.test.ts", "src/a.test.ts"])).toEqual([
		["test", "./src/a.test.ts"],
		["test", "./src/b.test.ts"],
	]);
	expect(
		testProcesses(["src/a.test.ts", "--test-name-pattern", "with spaces"], []),
	).toEqual([["test", "src/a.test.ts", "--test-name-pattern", "with spaces"]]);
});
test("database reset is restricted to explicit test names", () => {
	for (const name of ["artisan_test", "artisan_test_phase7_all"])
		expect(() => assertTestDatabaseName(name)).not.toThrow();
	for (const name of [
		"artisan",
		"postgres",
		"artisan_test;drop",
		'artisan_test_"',
		"other_test",
	])
		expect(() => assertTestDatabaseName(name)).toThrow("unsafe_test_database");
});
