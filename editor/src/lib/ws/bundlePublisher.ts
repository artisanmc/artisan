export interface PublishOptions {
  apiUrl: string;
  serverKey: string;
  projectId: string;
  files: Record<string, string>;
}

export interface PublishResult {
  hash: string;
}

export async function publishBundle(opts: PublishOptions): Promise<PublishResult> {
  // TODO(phase4-wire): `/bundles/:packId` path param flips to `:projectId` in
  // Phase 4 (the `/bundles` segment stays — Bundle is the canonical artifact).
  const res = await fetch(`${opts.apiUrl}/api/v1/bundles/${opts.projectId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.serverKey}`,
    },
    body: JSON.stringify({ files: opts.files }),
  });

  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  return res.json() as unknown as PublishResult;
}
