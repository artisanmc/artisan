import { db } from "../src/db/index";
import { packs } from "../src/db/schema";
import { createCommit } from "../src/lib/commitStorage";
import { createBranch, getBranch } from "../src/lib/branchStorage";

async function main() {
  const allPacks = await db.select().from(packs);
  console.log(`[migrate-2] Found ${allPacks.length} packs.`);
  for (const p of allPacks) {
    if (await getBranch(p.id, "main")) {
      console.log(`[migrate-2] ${p.id}: main branch already exists, skipping.`);
      continue;
    }
    const files = JSON.parse(p.filesJson || "{}") as Record<string, string>;
    const editor = p.editorJson ? JSON.parse(p.editorJson) : null;
    const root = await createCommit({
      packId: p.id,
      parentId: null,
      files,
      editor,
      authorUserId: null,
      message: "Initial commit (Phase 2 migration)",
    });
    await createBranch(p.id, "main", root.id);
    console.log(`[migrate-2] ${p.id}: created main branch @ ${root.id}`);
  }
  console.log("[migrate-2] Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
