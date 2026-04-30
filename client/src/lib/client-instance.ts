/**
 * Manages the client_instance_id in localStorage to ensure consistency across reloads.
 */

const CLIENT_ID_KEY = "lyceon_client_instance_id";

export function getClientInstanceId(): string {
  if (typeof window === "undefined") return "server-side";

  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id || id.trim().length === 0) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function resetClientInstanceId(): string {
  const newId = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, newId);
  return newId;
}
