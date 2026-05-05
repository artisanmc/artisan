export interface PublishOptions {
  apiUrl: string;
  serverKey: string;
  packId: string;
  files: Record<string, string>;
}

export interface PublishResult {
  hash: string;
}

export async function publishBundle(opts: PublishOptions): Promise<PublishResult> {
  const res = await fetch(`${opts.apiUrl}/api/bundles/${opts.packId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.serverKey}`,
    },
    body: JSON.stringify({ files: opts.files }),
  });

  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  return res.json() as Promise<PublishResult>;
}
