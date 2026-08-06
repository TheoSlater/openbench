import { tool } from "ai";
import { z } from "zod";
import { searchWeb, type SearchConfig, type SearchResult } from "./web-search";

type Fetch = typeof fetch;

type WeatherOutput = {
  location: string;
  source: "open-meteo";
  temperature: number;
  windSpeed: number;
  observedAt?: string;
};

type SearchOutput = {
  query: string;
  results: SearchResult[];
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function openMeteoWeather(
  location: string,
  providerFetch: Fetch,
): Promise<WeatherOutput> {
  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.search = new URLSearchParams({
    name: location,
    count: "1",
    language: "en",
    format: "json",
  }).toString();
  const geocode = await readJson(await providerFetch(geocodeUrl));
  const place = Array.isArray(geocode.results) && geocode.results[0]
    && typeof geocode.results[0] === "object"
    ? geocode.results[0] as Record<string, unknown>
    : null;
  if (
    !place
    || typeof place.latitude !== "number"
    || typeof place.longitude !== "number"
  ) throw new Error("Location not found");

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,wind_speed_10m",
    timezone: "auto",
  }).toString();
  const forecast = await readJson(await providerFetch(forecastUrl));
  const current = forecast.current && typeof forecast.current === "object"
    ? forecast.current as Record<string, unknown>
    : null;
  if (
    !current
    || typeof current.temperature_2m !== "number"
    || !Number.isFinite(current.temperature_2m)
    || typeof current.wind_speed_10m !== "number"
    || !Number.isFinite(current.wind_speed_10m)
  ) throw new Error("Current weather unavailable");

  const placeName = typeof place.name === "string" ? place.name : location;
  const country = typeof place.country === "string" ? `, ${place.country}` : "";
  return {
    location: `${placeName}${country}`,
    source: "open-meteo",
    temperature: current.temperature_2m,
    windSpeed: current.wind_speed_10m,
    observedAt: typeof current.time === "string" ? current.time : undefined,
  };
}

async function searchWeather(
  location: string,
  searchConfig: SearchConfig,
  providerFetch: Fetch,
): Promise<SearchOutput & { location: string; source: "web-search" }> {
  const query = `current weather in ${location}`;
  return {
    location,
    source: "web-search",
    query,
    results: await searchWeb(query, searchConfig, providerFetch),
  };
}

export function createWeatherTool(options: {
  fetch?: Fetch;
  search: SearchConfig;
}) {
  const providerFetch = options.fetch ?? fetch;
  return tool({
    description: "Get current weather using Open-Meteo, then fall back to web search if unavailable",
    inputSchema: z.object({
      location: z.string().trim().min(1).max(200).describe("Location to check"),
    }),
    strict: true,
    inputExamples: [{ input: { location: "London" } }],
    execute: async ({ location }) => {
      try {
        return await openMeteoWeather(location, providerFetch);
      } catch (openMeteoError) {
        try {
          return await searchWeather(location, options.search, providerFetch);
        } catch (searchError) {
          throw new Error(
            `Weather lookup failed: ${openMeteoError instanceof Error ? openMeteoError.message : "Open-Meteo unavailable"}; ${searchError instanceof Error ? searchError.message : "web search unavailable"}`,
          );
        }
      }
    },
  });
}

export function createStockTool(options: {
  fetch?: Fetch;
  search: SearchConfig;
}) {
  const providerFetch = options.fetch ?? fetch;
  return tool({
    description: "Search the web for a stock symbol and render the results",
    inputSchema: z.object({
      symbol: z.string().trim().min(1).max(12).describe("Stock symbol"),
    }),
    strict: true,
    inputExamples: [{ input: { symbol: "AAPL" } }],
    execute: async ({ symbol }) => {
      const query = `${symbol.toUpperCase()} stock price`;
      return {
        symbol: symbol.toUpperCase(),
        source: "web-search" as const,
        query,
        results: await searchWeb(query, options.search, providerFetch),
      };
    },
  });
}
