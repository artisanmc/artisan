const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage: string | null;
  theme: string | null;
  isAdmin: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserProfileDto extends AdminUserDto {
  networks: { id: string; name: string; slug: string | null; role: string }[];
}

export async function listAdminUsers(q: string): Promise<AdminUserDto[] | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/users?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { users: AdminUserDto[] };
  return body.users;
}

export async function getAdminUser(id: string): Promise<AdminUserProfileDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/users/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as AdminUserProfileDto;
}

export async function updateAdminUser(
  id: string,
  patch: { name?: string; email?: string; isAdmin?: boolean },
): Promise<{ ok: true; data: AdminUserDto } | { ok: false; status: number; error?: string }> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, ...(body.error ? { error: body.error } : {}) };
  }
  return { ok: true, data: (await res.json()) as AdminUserDto };
}
