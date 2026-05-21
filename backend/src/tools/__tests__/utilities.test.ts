import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTime, getWeather } from "../utilities.js";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getTime", () => {
  it("returns time with a default IANA timezone (America/Edmonton)", async () => {
    const result = await getTime({});
    expect(result.success).toBe(true);
    expect(result.timezone).toBe("America/Edmonton");
    expect(result.iso).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("uses the timezone parameter when provided", async () => {
    const result = await getTime({ timezone: "UTC" });
    expect(result.success).toBe(true);
    expect(result.timezone).toBe("UTC");
  });

  it("returns failure for an invalid timezone", async () => {
    const result = await getTime({ timezone: "Not/A_Real_Zone" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid timezone/i);
  });
});

describe("getWeather", () => {
  it("requires a location", async () => {
    const result = await getWeather({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/location/i);
  });

  it("returns weather for a known city via Open-Meteo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ name: "Edmonton", latitude: 53.5, longitude: -113.5, admin1: "Alberta", country: "Canada" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            current: {
              temperature_2m: 12,
              relative_humidity_2m: 50,
              apparent_temperature: 10,
              wind_speed_10m: 8,
              weather_code: 1,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const result = await getWeather({ location: "Edmonton" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.temperature).toBe(12);
    expect(result.location).toContain("Edmonton");
  });

  it("returns 'location not found' when geocoding has no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await getWeather({ location: "Atlantis" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
