import type { Env } from "./index";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export function parseJwt(token: string): {
  header: any;
  payload: any;
  signingInput: string;
  signature: Uint8Array;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  return {
    header: b64urlToJson(parts[0]),
    payload: b64urlToJson(parts[1]),
    signingInput: parts[0] + "." + parts[1],
    signature: b64urlToBytes(parts[2]),
  };
}

let jwksCache: { url: string; keys: Record<string, CryptoKey> } | null = null;

async function getKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  if (!jwksCache || jwksCache.url !== url || !jwksCache.keys[kid]) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const jwks = (await res.json()) as { keys: any[] };
    const keys: Record<string, CryptoKey> = {};
    for (const jwk of jwks.keys) {
      keys[jwk.kid] = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
    jwksCache = { url, keys };
  }
  return jwksCache.keys[kid] ?? null;
}

export async function verifyAccess(
  req: Request,
  env: Env,
): Promise<{ email: string } | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  let parsed;
  try {
    parsed = parseJwt(token);
  } catch {
    return null;
  }
  const { header, payload, signingInput, signature } = parsed;
  if (header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.email !== env.OPERATOR_EMAIL) return null;

  const key = await getKey(env, header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!ok) return null;
  return { email: payload.email };
}
