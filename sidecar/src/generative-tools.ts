import { tool } from "ai";
import { z } from "zod";

type Fetch = typeof fetch;

const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Source URL must use HTTP(S)");

const weatherDataSchema = z.object({
  temperatureC: z.number().finite().describe("Current temperature in Celsius"),
  windSpeedMps: z.number().finite().optional().describe("Wind speed in metres per second"),
  condition: z.string().trim().min(1).max(80).optional().describe("Short current condition"),
  observedAt: z.string().trim().min(1).max(80).optional().describe("Observation time"),
  summary: z.string().trim().min(1).max(500).optional().describe("One-sentence summary grounded in the search results"),
  sourceTitle: z.string().trim().min(1).max(200).optional().describe("Title of the most relevant search result"),
  sourceUrl: httpUrl.optional().describe("HTTP(S) URL of the most relevant search result"),
});

const stockDataSchema = z.object({
  company: z.string().trim().min(1).max(120).optional().describe("Company name"),
  price: z.number().finite().describe("Latest stock price"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).describe("ISO 4217 currency code"),
  change: z.number().finite().optional().describe("Absolute price change"),
  changePercent: z.number().finite().optional().describe("Percentage price change"),
  marketStatus: z.string().trim().min(1).max(40).optional().describe("Market status"),
  asOf: z.string().trim().min(1).max(80).optional().describe("Quote timestamp"),
  summary: z.string().trim().min(1).max(500).optional().describe("One-sentence summary grounded in the search results"),
  sourceTitle: z.string().trim().min(1).max(200).optional().describe("Title of the most relevant search result"),
  sourceUrl: httpUrl.optional().describe("HTTP(S) URL of the most relevant search result"),
});

type WeatherOutput = {
  location: string;
  source: "open-meteo" | "web-search";
  status?: "needs-web-search";
  query?: string;
  instruction?: string;
  temperature?: number;
  windSpeed?: number;
  condition?: string;
  observedAt?: string;
  summary?: string;
  sourceTitle?: string;
  sourceUrl?: string;
};

type StockOutput = {
  symbol: string;
  source: "web-search";
  status?: "needs-web-search";
  query?: string;
  instruction?: string;
  company?: string;
  price?: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  marketStatus?: string;
  asOf?: string;
  summary?: string;
  sourceTitle?: string;
  sourceUrl?: string;
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

export function createWeatherTool(options: { fetch?: Fetch }) {
  const providerFetch = options.fetch ?? fetch;
  return tool({
    description: "Render current weather. Call with a location for Open-Meteo; if it returns needs-web-search, call web_search and call this tool again with normalized data.",
    inputSchema: z.object({
      location: z.string().trim().min(1).max(200).describe("Location to check"),
      data: weatherDataSchema.optional().describe("Normalized weather facts from web_search"),
    }),
    strict: true,
    inputExamples: [{ input: { location: "London" } }],
    execute: async ({ location, data }): Promise<WeatherOutput> => {
      if (data) {
        return {
          location,
          source: "web-search",
          temperature: data.temperatureC,
          ...(data.windSpeedMps === undefined ? {} : { windSpeed: data.windSpeedMps }),
          ...(data.condition ? { condition: data.condition } : {}),
          ...(data.observedAt ? { observedAt: data.observedAt } : {}),
          ...(data.summary ? { summary: data.summary } : {}),
          ...(data.sourceTitle ? { sourceTitle: data.sourceTitle } : {}),
          ...(data.sourceUrl ? { sourceUrl: data.sourceUrl } : {}),
        };
      }
      try {
        return await openMeteoWeather(location, providerFetch);
      } catch {
        return {
          location,
          source: "open-meteo",
          status: "needs-web-search",
          query: `current weather in ${location}`,
          instruction: "Open-Meteo is unavailable. Call web_search, summarize the result, then call displayWeather again with data fields.",
        };
      }
    },
  });
}

export function createStockTool() {
  return tool({
    description: "Render a structured stock quote. Call web_search first, summarize the result, then call this tool with individual quote fields.",
    inputSchema: z.object({
      symbol: z.string().trim().min(1).max(12).describe("Stock symbol"),
      data: stockDataSchema.optional().describe("Normalized stock facts from web_search"),
    }),
    strict: true,
    inputExamples: [{ input: { symbol: "AAPL" } }],
    execute: async ({ symbol, data }): Promise<StockOutput> => {
      const normalizedSymbol = symbol.toUpperCase();
      if (!data) {
        return {
          symbol: normalizedSymbol,
          source: "web-search",
          status: "needs-web-search",
          query: `${normalizedSymbol} stock price`,
          instruction: "Call web_search, summarize the result, then call getStockPrice again with data fields.",
        };
      }
      return {
        symbol: normalizedSymbol,
        source: "web-search",
        price: data.price,
        currency: data.currency.toUpperCase(),
        ...(data.company ? { company: data.company } : {}),
        ...(data.change === undefined ? {} : { change: data.change }),
        ...(data.changePercent === undefined ? {} : { changePercent: data.changePercent }),
        ...(data.marketStatus ? { marketStatus: data.marketStatus } : {}),
        ...(data.asOf ? { asOf: data.asOf } : {}),
        ...(data.summary ? { summary: data.summary } : {}),
        ...(data.sourceTitle ? { sourceTitle: data.sourceTitle } : {}),
        ...(data.sourceUrl ? { sourceUrl: data.sourceUrl } : {}),
      };
    },
  });
}
