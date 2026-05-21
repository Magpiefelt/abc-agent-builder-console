/**
 * Utility Tools
 *
 * Implements get_time and get_weather tools for the agent.
 * These are lightweight tools with minimal external dependencies.
 */

import { logger } from "../services/logger.js";

// ============================================================================
// GET TIME
// ============================================================================

export interface TimeResult {
  success: boolean;
  time?: string;
  timezone?: string;
  iso?: string;
  date?: string;
  dayOfWeek?: string;
  error?: string;
}

/**
 * Get the current time in a specified timezone.
 */
export async function getTime(params: Record<string, unknown>): Promise<TimeResult> {
  const timezone = (params.timezone as string) || "America/Edmonton";

  try {
    const now = new Date();

    const formatted = now.toLocaleString("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const dateStr = now.toLocaleDateString("en-CA", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const dayOfWeek = now.toLocaleDateString("en-CA", {
      timeZone: timezone,
      weekday: "long",
    });

    return {
      success: true,
      time: formatted,
      timezone,
      iso: now.toISOString(),
      date: dateStr,
      dayOfWeek,
    };
  } catch {
    return {
      success: false,
      error: `Invalid timezone: "${timezone}". Use IANA format (e.g., America/Edmonton, UTC, Europe/London).`,
    };
  }
}

// ============================================================================
// GET WEATHER
// ============================================================================

export interface WeatherResult {
  success: boolean;
  location?: string;
  temperature?: number;
  description?: string;
  humidity?: number;
  windSpeed?: number;
  feelsLike?: number;
  error?: string;
}

/**
 * Get current weather for a location using the Open-Meteo API (free, no key required).
 * Uses geocoding to resolve location names to coordinates.
 */
export async function getWeather(params: Record<string, unknown>): Promise<WeatherResult> {
  const location = params.location as string;

  if (!location || typeof location !== "string" || location.trim().length === 0) {
    return { success: false, error: "A location parameter is required." };
  }

  try {
    // Step 1: Geocode the location name to coordinates
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", location.trim());
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "en");

    const geocodeResponse = await fetch(geocodeUrl.toString(), {
      headers: { "User-Agent": "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)" },
    });

    if (!geocodeResponse.ok) {
      return { success: false, error: `Geocoding failed (${geocodeResponse.status}).` };
    }

    const geocodeData = await geocodeResponse.json() as Record<string, unknown>;
    const results = geocodeData.results as Array<Record<string, unknown>> | undefined;

    if (!results || results.length === 0) {
      return { success: false, error: `Location "${location}" not found. Try a different city name.` };
    }

    const place = results[0];
    const lat = place.latitude as number;
    const lon = place.longitude as number;
    const resolvedName = `${place.name}, ${place.admin1 || ""}, ${place.country || ""}`.replace(/, ,/g, ",").replace(/,$/, "");

    // Step 2: Fetch weather data
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(lat));
    weatherUrl.searchParams.set("longitude", String(lon));
    weatherUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code");
    weatherUrl.searchParams.set("temperature_unit", "celsius");
    weatherUrl.searchParams.set("wind_speed_unit", "kmh");

    const weatherResponse = await fetch(weatherUrl.toString(), {
      headers: { "User-Agent": "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)" },
    });

    if (!weatherResponse.ok) {
      return { success: false, error: `Weather API failed (${weatherResponse.status}).` };
    }

    const weatherData = await weatherResponse.json() as Record<string, unknown>;
    const current = weatherData.current as Record<string, unknown>;

    if (!current) {
      return { success: false, error: "No current weather data available." };
    }

    // Map WMO weather codes to descriptions
    const weatherCode = current.weather_code as number;
    const description = mapWeatherCode(weatherCode);

    return {
      success: true,
      location: resolvedName,
      temperature: current.temperature_2m as number,
      description,
      humidity: current.relative_humidity_2m as number,
      windSpeed: current.wind_speed_10m as number,
      feelsLike: current.apparent_temperature as number,
    };
  } catch (err) {
    logger.error("Weather lookup failed", err, { location });
    return { success: false, error: `Weather lookup failed: ${(err as Error).message}` };
  }
}

/**
 * Map WMO weather codes to human-readable descriptions.
 */
function mapWeatherCode(code: number): string {
  const codes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return codes[code] || `Weather code ${code}`;
}
