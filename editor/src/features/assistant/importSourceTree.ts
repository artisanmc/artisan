import type { ImportSourceFile } from "@/lib/api/importSources";

export interface ImportTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number;
  children: ImportTreeNode[];
}

function compareNodes(a: ImportTreeNode, b: ImportTreeNode): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  const foldedA = a.name.toLowerCase();
  const foldedB = b.name.toLowerCase();
  if (foldedA !== foldedB) return foldedA < foldedB ? -1 : 1;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

export function buildImportTree(files: ImportSourceFile[]): ImportTreeNode[] {
  const roots: ImportTreeNode[] = [];

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let siblings = roots;
    for (const [index, name] of segments.entries()) {
      const path = segments.slice(0, index + 1).join("/");
      const isFile = index === segments.length - 1;
      let node = siblings.find((candidate) => candidate.name === name);
      if (!node) {
        node = {
          name,
          path,
          kind: isFile ? "file" : "directory",
          size: 0,
          children: [],
        };
        siblings.push(node);
      }
      if (isFile) node.size = file.size;
      siblings = node.children;
    }
  }

  function finish(nodes: ImportTreeNode[]): number {
    nodes.sort(compareNodes);
    let total = 0;
    for (const node of nodes) {
      if (node.kind === "directory") node.size = finish(node.children);
      total += node.size;
    }
    return total;
  }

  finish(roots);
  return roots;
}

export function descendantFiles(node: ImportTreeNode): ImportSourceFile[] {
  if (node.kind === "file") return [{ path: node.path, size: node.size }];
  return node.children.flatMap(descendantFiles);
}

export function toggleTreePath(
  selected: Set<string>,
  node: ImportTreeNode,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const file of descendantFiles(node)) {
    if (checked) next.add(file.path);
    else next.delete(file.path);
  }
  return next;
}

export function selectionState(
  selected: Set<string>,
  node: ImportTreeNode,
): "none" | "some" | "all" {
  const files = descendantFiles(node);
  const selectedCount = files.reduce((count, file) => count + (selected.has(file.path) ? 1 : 0), 0);
  if (selectedCount === 0) return "none";
  if (selectedCount === files.length) return "all";
  return "some";
}

export function filterImportTree(nodes: ImportTreeNode[], query: string): ImportTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;

  const filtered: ImportTreeNode[] = [];
  for (const node of nodes) {
    if (
      node.name.toLowerCase().includes(normalized) ||
      node.path.toLowerCase().includes(normalized)
    ) {
      filtered.push(node);
      continue;
    }
    if (node.kind === "directory") {
      const children = filterImportTree(node.children, normalized);
      if (children.length > 0) filtered.push({ ...node, children });
    }
  }
  return filtered;
}

export function summarizeSelection(
  selected: Set<string>,
  nodes: ImportTreeNode[],
): { count: number; bytes: number } {
  const filesByPath = new Map<string, ImportSourceFile>();
  for (const node of nodes) {
    for (const file of descendantFiles(node)) filesByPath.set(file.path, file);
  }

  let count = 0;
  let bytes = 0;
  for (const path of selected) {
    const file = filesByPath.get(path);
    if (!file) continue;
    count += 1;
    bytes += file.size;
  }
  return { count, bytes };
}
