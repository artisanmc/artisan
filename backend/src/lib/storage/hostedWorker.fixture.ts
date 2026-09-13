import { HostedProjectStorage } from "./HostedProjectStorage";
const options = JSON.parse(
	Buffer.from(process.argv[2]!, "base64").toString("utf8"),
);
const storage = await HostedProjectStorage.open(options);
const outcome = await storage.write({
	files: [{ path: "worker.yaml", content: process.argv[3]!, base_hash: null }],
});
process.stdout.write(JSON.stringify(outcome));
process.exit(0);
