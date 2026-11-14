"use client";

const KEY = "adminToken";

/**
 * fetch() for admin actions. Sends the remembered admin password; on 403 asks for it once and retries.
 * Returns null if the person cancels the prompt.
 */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  const send = (token: string) =>
    fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "x-admin-token": token } });
  let token = localStorage.getItem(KEY) ?? "";
  let res = await send(token);
  if (res.status !== 403) return res;
  const entered = prompt("This action needs the admin password.");
  if (!entered) return null;
  token = entered.trim();
  res = await send(token);
  if (res.status === 403) {
    alert("That password isn’t right.");
    return null;
  }
  localStorage.setItem(KEY, token);
  return res;
}
