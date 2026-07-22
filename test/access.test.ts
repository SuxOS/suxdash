import { describe, it, expect } from "vitest";
import { parseJwt } from "../src/access";

describe("parseJwt", () => {
  it("splits a JWT into header, payload, signing input, and signature bytes", () => {
    // header {"alg":"RS256","kid":"k1"} . payload {"email":"a@b.com","aud":["x"]} . sig "AQAB"
    const token =
      "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0" +
      ".eyJlbWFpbCI6ImFAYi5jb20iLCJhdWQiOlsieCJdfQ" +
      ".AQAB";
    const parsed = parseJwt(token);
    expect(parsed.header.kid).toBe("k1");
    expect(parsed.payload.email).toBe("a@b.com");
    expect(parsed.payload.aud).toEqual(["x"]);
    expect(parsed.signingInput).toBe(token.slice(0, token.lastIndexOf(".")));
    expect(parsed.signature).toBeInstanceOf(Uint8Array);
  });

  it("throws on a malformed token", () => {
    expect(() => parseJwt("not-a-jwt")).toThrow();
  });
});
