// Small HTTP helpers for a JSON API Worker: CORS for an allow-list of origins, JSON responses,
// a constant-time secret check and body parsing. Reusable as is.

// CORS headers for this request, and whether its origin is allowed. allowedOrigins: "https://a.com, http://localhost:8000"
export function cors(request, allowedOrigins, { methods = "GET, POST, OPTIONS", headers = "Content-Type, X-Passcode" } = {}) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(allowedOrigins || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const ok = !origin || allowed.includes(origin);
  return {
    ok, origin,
    headers: {
      "Access-Control-Allow-Origin": ok && origin ? origin : allowed[0] || "null",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": headers,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

export const jsonResponse = (headers) => (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// The request's JSON body, or undefined when it isn't JSON.
export async function readJson(request) { try { return await request.json(); } catch { return undefined; } }

// Compares two secrets in constant time (hashes first, so lengths don't leak either).
export async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}
