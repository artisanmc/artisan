export function vitestWorkerExecArgv(nodeVersion = process.versions.node) {
  const major = Number.parseInt(nodeVersion.split(".")[0], 10);
  return major >= 25 ? ["--no-webstorage"] : [];
}
