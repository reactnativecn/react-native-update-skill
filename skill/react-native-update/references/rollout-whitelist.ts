/** Client-side rollout guard, not an authorization or server rollout replacement. */
export function isUserAllowed(metaInfo: unknown, currentUserId: unknown): boolean {
  if (typeof currentUserId !== 'string' || currentUserId.length === 0) return false;
  if (typeof metaInfo !== 'string' || metaInfo.length === 0) return false;
  try {
    const meta: unknown = JSON.parse(metaInfo);
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return false;
    const allowUsers = (meta as { allowUsers?: unknown }).allowUsers;
    return Array.isArray(allowUsers)
      && allowUsers.every((id: unknown) => typeof id === 'string')
      && allowUsers.includes(currentUserId);
  } catch {
    return false;
  }
}
