import { supabase } from "@/lib/supabase/client";

// The privileged backend, reached through the same-origin /api/* rewrite
// (API_PROXY_TARGET in next.config.ts). Bearer token is the caller's own
// Supabase session — the backend verifies it against Supabase's JWKS.

export class BackendError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) throw new Error("Supabase is not configured");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function backendFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(await authHeader()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new BackendError(json.error ?? `Request failed (${res.status})`, res.status, json.code);
  }
  return json as T;
}
