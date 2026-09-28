import { TAB_HEADER } from '../ws/client';

/** HTTP failures and network failures share one action contract. */
export async function checkedFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`);
  }
  return response;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  // The tab header lets a create/open route navigate only this tab. adr: adr/per-tab-view.md
  return { method, headers: { 'Content-Type': 'application/json', ...TAB_HEADER }, body: JSON.stringify(body) };
}
