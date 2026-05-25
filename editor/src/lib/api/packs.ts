export interface DeletePackOptions {
  apiUrl: string;
  token: string;
  packId: string;
}

export async function deletePack({ apiUrl, token, packId }: DeletePackOptions): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/editor-session/${token}/packs/${packId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("pack_not_found");
    throw new Error(`delete_failed_${res.status}`);
  }
}
