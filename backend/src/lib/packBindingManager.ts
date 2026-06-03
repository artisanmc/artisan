// Task 1.2: pack_bindings table dropped in P1 schema refactor.
// This module is a stub kept for Task 1.5 final cleanup.
// All callers have been migrated to use packs.serverKeyId directly.

export async function createBinding(
  _serverKeyId: string,
  _packId: string,
  _branchName: string = "main",
): Promise<void> {
  // no-op: binding is now implicit via packs.serverKeyId
}

export async function deleteBinding(_serverKeyId: string, _packId: string): Promise<void> {
  // no-op: pack ownership is fixed at creation in the 1:1 model
}

export async function listPacksForServerKey(_serverKeyId: string): Promise<never[]> {
  return [];
}

export async function listServerKeysForPack(_packId: string): Promise<string[]> {
  return [];
}
