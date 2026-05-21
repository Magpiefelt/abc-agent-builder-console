import { describe, it, expect } from "vitest";
import { extractMinistry, claimsToAuthUser } from "../entraAuth.js";

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
