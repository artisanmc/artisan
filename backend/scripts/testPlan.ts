export function assertTestDatabaseName(name: string): void {
	if (!/^artisan_test(?:_[a-z0-9_]+)?$/.test(name))
		throw new Error("unsafe_test_database");
}
export function testProcesses(args: string[], files: string[]): string[][] {
	return args.length
		? [["test", ...args]]
		: [...files].sort().map((file) => ["test", `./${file}`]);
}
