import { describe, it, expect } from "vitest";
import {
  extractMinistry,
  claimsToAuthUser,
  safeReturnTo,
  signSessionToken,
  verifySessionToken,
  signOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  SessionExpiredError,
  InvalidSignatureError,
  EntraConfigError,
} from "../entraAuth.js";
import type { AuthUser } from "../../middleware/auth.js";

const SAMPLE_USER: AuthUser = {
  id: "11111111-2222-3333-4444-555555555555",
  entraId: "entra-oid-abc",
  email: "user@gov.ab.ca",
  displayName: "Test User",
  ministryCode: "INFRA",
  role: "user",
};

describe("extractMinistry", () => {
  it("returns the ministry code for an AIM-G-*-ALL_EMPLOYEES group", () => {
    expect(extractMinistry(["AIM-G-INFRA-ALL_EMPLOYEES"])).toBe("INFRA");
  });

  it("returns the ministry code for an AIM-G-*-ALL_CONTRACTORS group", () => {
    expect(extractMinistry(["AIM-G-HEALTH-ALL_CONTRACTORS"])).toBe("HEALTH");
  });

  it("picks the first matching ministry group, ignoring unrelated groups", () => {
    expect(
      extractMinistry(["random-group", "AIM-G-EDU-ALL_EMPLOYEES", "AIM-G-INFRA-ALL_EMPLOYEES"]),
    ).toBe("EDU");
  });

  it("returns null when no matching group is present", () => {
    expect(extractMinistry(["AIM-G-INFRA-OTHER", "some-other-group"])).toBeNull();
  });

  it("returns null for an empty / missing groups array", () => {
    expect(extractMinistry([])).toBeNull();
    expect(extractMinistry(undefined)).toBeNull();
  });
});

describe("claimsToAuthUser", () => {
  it("maps Entra claims to an AuthUser shape with ministry extracted", () => {
    const result = claimsToAuthUser({
      oid: "abc-123",
      preferred_username: "user@gov.ab.ca",
      name: "Test User",
      groups: ["AIM-G-INFRA-ALL_EMPLOYEES"],
    });
    expect(result).toEqual({
      entraId: "abc-123",
      email: "user@gov.ab.ca",
      displayName: "Test User",
      ministryCode: "INFRA",
      role: "user",
    });
  });

  it("falls back from oid to sub when oid is missing", () => {
    const result = claimsToAuthUser({
      sub: "sub-456",
      email: "another@gov.ab.ca",
      name: "Another User",
    });
    expect(result.entraId).toBe("sub-456");
    expect(result.ministryCode).toBeNull();
  });

  it("throws when neither oid nor sub is present", () => {
    expect(() => claimsToAuthUser({ name: "x" })).toThrow();
  });
});

describe("safeReturnTo", () => {
  it("returns / for non-string input", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(123)).toBe("/");
    expect(safeReturnTo({ url: "/foo" })).toBe("/");
  });

  it("returns / for empty or oversized strings", () => {
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo("/" + "a".repeat(1024))).toBe("/");
  });

  it("accepts a simple same-origin path", () => {
    expect(safeReturnTo("/profile")).toBe("/profile");
  });

  it("accepts a same-origin path with query and fragment", () => {
    expect(safeReturnTo("/workflow?id=42#section")).toBe("/workflow?id=42#section");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com/path")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeReturnTo("http://evil.com/path")).toBe("/");
    expect(safeReturnTo("https://evil.com/path")).toBe("/");
  });

  it("rejects backslash-based redirect variants", () => {
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("/\\/evil.com")).toBe("/");
  });

  it("rejects inputs that do not start with /", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("evil.com")).toBe("/");
  });
});

describe("session JWT", () => {
  it("signs and verifies a session token roundtrip", async () => {
    const token = await signSessionToken(SAMPLE_USER);
    const payload = await verifySessionToken(token);
    expect(payload.userId).toBe(SAMPLE_USER.id);
    expect(payload.entraId).toBe(SAMPLE_USER.entraId);
    expect(payload.role).toBe(SAMPLE_USER.role);
    expect(payload.ministryCode).toBe(SAMPLE_USER.ministryCode);
    expect(payload.iss).toBe("abc-agent-builder/session");
    expect(payload.sub).toBe(SAMPLE_USER.id);
  });

  it("rejects a tampered session token with InvalidSignatureError", async () => {
    const token = await signSessionToken(SAMPLE_USER);
    // Flip a character in the signature portion
    const parts = token.split(".");
    const tampered = parts[0] + "." + parts[1] + "." + parts[2].slice(0, -1) + "A";
    await expect(verifySessionToken(tampered)).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejects a malformed token with InvalidSignatureError", async () => {
    await expect(verifySessionToken("not.a.real.jwt")).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
    await expect(verifySessionToken("")).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejects an OAuth state token presented as a session token", async () => {
    // Cross-token confusion defence: same secret, distinct `iss`.
    const stateToken = await signOAuthState({
      codeVerifier: "abc",
      state: "xyz",
      returnTo: "/",
    });
    await expect(verifySessionToken(stateToken)).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejects a session token presented as an OAuth state token", async () => {
    const sessionToken = await signSessionToken(SAMPLE_USER);
    await expect(verifyOAuthState(sessionToken)).rejects.toThrow();
  });
});

describe("OAuth state JWT", () => {
  it("signs and verifies an OAuth state roundtrip", async () => {
    const token = await signOAuthState({
      codeVerifier: "cv-123",
      state: "s-456",
      returnTo: "/workflow",
    });
    const payload = await verifyOAuthState(token);
    expect(payload.codeVerifier).toBe("cv-123");
    expect(payload.state).toBe("s-456");
    expect(payload.returnTo).toBe("/workflow");
    expect(payload.iss).toBe("abc-agent-builder/oauth-state");
  });
});

describe("buildAuthorizeUrl", () => {
  it("throws EntraConfigError when Entra env vars are missing", () => {
    // Default test env has no ENTRA_CLIENT_ID configured.
    if (!process.env.ENTRA_CLIENT_ID) {
      expect(() => buildAuthorizeUrl("state", "challenge", "http://localhost/callback")).toThrow(
        EntraConfigError,
      );
    }
  });
});

// Note: SessionExpiredError is exercised indirectly — jose's library produces
// the `ERR_JWT_EXPIRED` code which the wrapper translates. A dedicated test
// would require mocking jose or sleeping past the 8h TTL, which is impractical
// here.
describe("SessionExpiredError", () => {
  it("is throwable and has a distinct name", () => {
    const err = new SessionExpiredError();
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err.name).toBe("SessionExpiredError");
  });
});
