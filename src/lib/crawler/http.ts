// HTTP helpers for the crawler: browser-like headers, timeouts and a per-host concurrency cap
// so we never hammer a single careers site.

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

const PER_HOST = 2;
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

async function acquire(host: string) {
  const n = active.get(host) ?? 0;
  if (n < PER_HOST) {
    active.set(host, n + 1);
    return;
  }
  await new Promise<void>((resolve) => {
    const q = waiting.get(host) ?? [];
    q.push(resolve);
    waiting.set(host, q);
  });
  active.set(host, (active.get(host) ?? 0) + 1);
}

function release(host: string) {
  active.set(host, (active.get(host) ?? 1) - 1);
  const next = waiting.get(host)?.shift();
  if (next) next();
}

export interface HttpResult {
  status: number;
  text: string;
  url: string;
}

export async function httpGet(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<HttpResult> {
  const host = new URL(url).host;
  await acquire(host);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers: { ...HEADERS, ...opts.headers },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
    return { status: res.status, text: await res.text(), url: res.url };
  } finally {
    release(host);
  }
}

export async function httpJson<T = unknown>(url: string, opts: Parameters<typeof httpGet>[1] = {}): Promise<T | null> {
  const r = await httpGet(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  if (r.status < 200 || r.status >= 300) return null;
  try {
    return JSON.parse(r.text) as T;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
