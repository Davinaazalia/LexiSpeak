import type { NextRequest } from "next/server";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __lexispeakRateLimitStore?: Map<string, RateLimitBucket>;
};

function getRateLimitStore(): Map<string, RateLimitBucket> {
  if (!globalStore.__lexispeakRateLimitStore) {
    globalStore.__lexispeakRateLimitStore = new Map<string, RateLimitBucket>();
  }
  return globalStore.__lexispeakRateLimitStore;
}

export function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function enforceRateLimit(
  request: NextRequest,
  scope: string,
  options: { max: number; windowMs: number }
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const ip = getClientIp(request);
  const key = `${scope}:${ip}`;
  const store = getRateLimitStore();
  const bucket = store.get(key);

  if (!bucket || now > bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true };
  }

  if (bucket.count >= options.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { ok: false, retryAfter };
  }

  bucket.count += 1;
  store.set(key, bucket);
  return { ok: true };
}
