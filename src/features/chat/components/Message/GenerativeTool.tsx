import { AlertCircle, CloudSun, DollarSign, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type GenerativeToolName = "displayWeather" | "getStockPrice";

type GenerativeToolProps = {
  toolName: GenerativeToolName;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type SearchResult = {
  title: string;
  url: string;
  highlights: string[];
};

type SearchOutput = {
  subject: string;
  query: string;
  results: SearchResult[];
};

type WeatherOutput = {
  location: string;
  temperature: number;
  windSpeed: number;
  observedAt?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function searchOutput(value: unknown, subjectKey: "location" | "symbol"): SearchOutput | null {
  const item = record(value);
  if (
    typeof item?.[subjectKey] !== "string"
    || typeof item.query !== "string"
    || !Array.isArray(item.results)
  ) return null;
  const results = item.results.flatMap((value): SearchResult[] => {
    const result = record(value);
    if (typeof result?.title !== "string" || typeof result.url !== "string") return [];
    try {
      const url = new URL(result.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [{
      title: result.title,
      url: result.url,
      highlights: Array.isArray(result.highlights)
        ? result.highlights.filter((item): item is string => typeof item === "string")
        : [],
    }];
  });
  return {
    subject: item[subjectKey],
    query: item.query,
    results,
  };
}

function weatherOutput(value: unknown): WeatherOutput | null {
  const item = record(value);
  if (
    item?.source !== "open-meteo"
    || typeof item.location !== "string"
    || typeof item.temperature !== "number"
    || !Number.isFinite(item.temperature)
    || typeof item.windSpeed !== "number"
    || !Number.isFinite(item.windSpeed)
  ) return null;
  return {
    location: item.location,
    temperature: item.temperature,
    windSpeed: item.windSpeed,
    observedAt: typeof item.observedAt === "string" ? item.observedAt : undefined,
  };
}

function inputValue(input: unknown, key: string): string | undefined {
  const value = record(input)?.[key];
  return typeof value === "string" ? value : undefined;
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5 shadow-none">
      <CardContent className="flex items-center gap-3 py-4 text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="truncate text-sm text-destructive/80">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherCard({ value }: { value: WeatherOutput }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudSun className="size-5 text-amber-500" />
            <CardTitle>Current weather</CardTitle>
          </div>
          <Badge variant="secondary">{value.location}</Badge>
        </div>
        <CardDescription>
          Open-Meteo{value.observedAt ? ` · ${value.observedAt}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Temperature</p>
          <p className="text-2xl font-semibold tracking-tight">{value.temperature.toFixed(1)}°C</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Wind</p>
          <p className="text-2xl font-semibold tracking-tight">{value.windSpeed.toFixed(1)} m/s</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SearchCard({
  toolName,
  value,
}: {
  toolName: GenerativeToolName;
  value: SearchOutput;
}) {
  const weather = toolName === "displayWeather";
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {weather
              ? <CloudSun className="size-5 text-amber-500" />
              : <DollarSign className="size-5 text-emerald-500" />}
            <CardTitle>{weather ? "Weather search" : "Stock search"}</CardTitle>
          </div>
          <Badge variant="secondary">{value.subject}</Badge>
        </div>
        <CardDescription>{value.query}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {value.results.length ? value.results.slice(0, 4).map((result) => (
          <a
            key={result.url}
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-2 transition-colors hover:bg-muted"
          >
            <p className="truncate font-medium">{result.title}</p>
            {result.highlights[0] ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{result.highlights[0]}</p>
            ) : null}
          </a>
        )) : (
          <p className="text-sm text-muted-foreground">No search results found.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function GenerativeTool({
  toolName,
  state,
  input,
  output,
  errorText,
}: GenerativeToolProps) {
  if (state === "output-available") {
    if (toolName === "displayWeather") {
      const value = weatherOutput(output);
      if (value) return <WeatherCard value={value} />;
    }
    const value = searchOutput(
      output,
      toolName === "displayWeather" ? "location" : "symbol",
    );
    return value
      ? <SearchCard toolName={toolName} value={value} />
      : <ErrorCard title="Search unavailable" message="Tool returned invalid search data." />;
  }

  if (["output-error", "input-error", "output-denied"].includes(state)) {
    return (
      <ErrorCard
        title={`${toolName === "displayWeather" ? "Weather" : "Stock price"} unavailable`}
        message={errorText || "Tool could not complete."}
      />
    );
  }

  const value = inputValue(input, toolName === "displayWeather" ? "location" : "symbol");
  const label = toolName === "displayWeather" ? "Fetching weather" : "Fetching stock price";
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {label}
        </CardTitle>
        <CardDescription>{value || "Preparing tool result…"}</CardDescription>
      </CardHeader>
    </Card>
  );
}
