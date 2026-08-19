import { errorMessage } from '../logger.js';

export interface JsonRequest {
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function request(req: JsonRequest): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 30_000);
  try {
    return await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...req.headers,
      },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`${req.method ?? 'GET'} ${req.url} failed: ${errorMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(req: JsonRequest): Promise<T> {
  const res = await request(req);
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(
      `${req.method ?? 'GET'} ${req.url} -> ${res.status}: ${text.slice(0, 400)}`,
      res.status,
      text,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${req.url} returned non-JSON body: ${text.slice(0, 200)}`);
  }
}

/** For endpoints that return raw serialised transaction bytes. */
export async function fetchBytes(req: JsonRequest): Promise<Uint8Array> {
  const res = await request(req);
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(
      `${req.method ?? 'GET'} ${req.url} -> ${res.status}: ${text.slice(0, 400)}`,
      res.status,
      text,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
