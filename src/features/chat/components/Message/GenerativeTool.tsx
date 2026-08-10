import {
  AlertCircle,
  CloudSun,
  DollarSign,
  ExternalLink,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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

type WeatherOutput =
  | {
    kind: "pending";
    location: string;
    source: "open-meteo" | "web-search";
    query?: string;
  }
  | {
    kind: "data";
    location: string;
    source: "open-meteo" | "web-search";
    temperature: number;
    windSpeed?: number;
    condition?: string;
    observedAt?: string;
    summary?: string;
    sourceTitle?: string;
    sourceUrl?: string;
  };

type StockOutput =
  | {
    kind: "pending";
    symbol: string;
    query?: string;
  }
  | {
    kind: "data";
    symbol: string;
    company?: string;
    price: number;
    currency: string;
    change?: number;
    changePercent?: number;
    marketStatus?: string;
    asOf?: string;
    summary?: string;
    sourceTitle?: string;
    sourceUrl?: string;
  };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(item: Record<string, unknown>, key: string): number | undefined | null {
  if (!(key in item)) return undefined;
  return finiteNumber(item[key]) ? item[key] : null;
}

function optionalText(item: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in item)) return undefined;
  return typeof item[key] === "string" && item[key].trim() ? item[key].trim() : null;
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceFields(item: Record<string, unknown>): {
  sourceTitle?: string;
  sourceUrl?: string;
} | null {
  const sourceTitle = optionalText(item, "sourceTitle");
  const sourceUrl = item.sourceUrl === undefined
    ? undefined
    : httpUrl(item.sourceUrl) ? item.sourceUrl : null;
  if (sourceTitle === null || sourceUrl === null) return null;
  return {
    ...(sourceTitle === undefined ? {} : { sourceTitle }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

function weatherOutput(value: unknown): WeatherOutput | null {
  const item = record(value);
  if (
    (item?.source !== "open-meteo" && item?.source !== "web-search")
    || typeof item.location !== "string"
    || !item.location.trim()
  ) return null;
  const location = item.location.trim();
  if (item.status === "needs-web-search") {
    return {
      kind: "pending",
      location,
      source: item.source,
      ...(typeof item.query === "string" ? { query: item.query } : {}),
    };
  }
  if (item.status !== undefined || !finiteNumber(item.temperature)) return null;
  const windSpeed = optionalNumber(item, "windSpeed");
  const condition = optionalText(item, "condition");
  const observedAt = optionalText(item, "observedAt");
  const summary = optionalText(item, "summary");
  const sources = sourceFields(item);
  if (windSpeed === null || condition === null || observedAt === null || summary === null || !sources) return null;
  return {
    kind: "data",
    location,
    source: item.source,
    temperature: item.temperature,
    ...(windSpeed === undefined ? {} : { windSpeed }),
    ...(condition === undefined ? {} : { condition }),
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(summary === undefined ? {} : { summary }),
    ...sources,
  };
}

function stockOutput(value: unknown): StockOutput | null {
  const item = record(value);
  if (
    item?.source !== "web-search"
    || typeof item.symbol !== "string"
    || !item.symbol.trim()
  ) return null;
  const symbol = item.symbol.trim().toUpperCase();
  if (item.status === "needs-web-search") {
    return {
      kind: "pending",
      symbol,
      ...(typeof item.query === "string" ? { query: item.query } : {}),
    };
  }
  if (
    item.status !== undefined
    || !finiteNumber(item.price)
    || typeof item.currency !== "string"
    || !item.currency.trim()
  ) return null;
  const company = optionalText(item, "company");
  const change = optionalNumber(item, "change");
  const changePercent = optionalNumber(item, "changePercent");
  const marketStatus = optionalText(item, "marketStatus");
  const asOf = optionalText(item, "asOf");
  const summary = optionalText(item, "summary");
  const sources = sourceFields(item);
  if (
    company === null
    || change === null
    || changePercent === null
    || marketStatus === null
    || asOf === null
    || summary === null
    || !sources
  ) return null;
  return {
    kind: "data",
    symbol,
    price: item.price,
    currency: item.currency.trim().toUpperCase(),
    ...(company === undefined ? {} : { company }),
    ...(change === undefined ? {} : { change }),
    ...(changePercent === undefined ? {} : { changePercent }),
    ...(marketStatus === undefined ? {} : { marketStatus }),
    ...(asOf === undefined ? {} : { asOf }),
    ...(summary === undefined ? {} : { summary }),
    ...sources,
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

function SearchPendingCard({ subject }: { subject: string }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Searching the web…
        </CardTitle>
        <CardDescription>{subject}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function SourceLink({ title, url }: { title?: string; url?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <span className="truncate">{title || "Source"}</span>
      <ExternalLink className="size-3.5 shrink-0" />
    </a>
  );
}

function WeatherCard({ value }: { value: Extract<WeatherOutput, { kind: "data" }> }) {
  const source = value.source === "open-meteo" ? "Open-Meteo" : "Web search";
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CloudSun className="size-5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <CardTitle>Current weather</CardTitle>
              <CardDescription className="truncate">{source}{value.observedAt ? ` · ${value.observedAt}` : ""}</CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="max-w-[45%] truncate">{value.location}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className={`grid gap-3 ${value.windSpeed === undefined ? "grid-cols-1" : "grid-cols-2"}`}>
          <div>
            <p className="text-sm text-muted-foreground">Temperature</p>
            <p className="text-2xl font-semibold tracking-tight">{value.temperature.toFixed(1)}°C</p>
          </div>
          {value.windSpeed === undefined ? null : (
            <div>
              <p className="text-sm text-muted-foreground">Wind</p>
              <p className="text-2xl font-semibold tracking-tight">{value.windSpeed.toFixed(1)} m/s</p>
            </div>
          )}
        </div>
        {value.condition || value.summary ? (
          <div className="space-y-1 rounded-lg bg-muted/50 p-3">
            {value.condition ? <p className="font-medium">{value.condition}</p> : null}
            {value.summary ? <p className="text-sm text-muted-foreground">{value.summary}</p> : null}
          </div>
        ) : null}
        <SourceLink title={value.sourceTitle} url={value.sourceUrl} />
      </CardContent>
    </Card>
  );
}

function formatPrice(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatChange(change?: number, changePercent?: number): string | undefined {
  if (change === undefined && changePercent === undefined) return undefined;
  const amount = change === undefined ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
  const percent = changePercent === undefined
    ? undefined
    : `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
  return [amount, percent ? `(${percent})` : undefined].filter(Boolean).join(" ");
}

function StockCard({ value }: { value: Extract<StockOutput, { kind: "data" }> }) {
  const change = formatChange(value.change, value.changePercent);
  const positive = (value.change ?? value.changePercent ?? 0) >= 0;
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <DollarSign className="size-5 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <CardTitle className="truncate">{value.company || value.symbol}</CardTitle>
              <CardDescription className="truncate">{value.symbol} · Web search{value.asOf ? ` · ${value.asOf}` : ""}</CardDescription>
            </div>
          </div>
          {value.marketStatus ? <Badge variant="secondary">{value.marketStatus}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Price</p>
            <p className="text-2xl font-semibold tracking-tight">{formatPrice(value.price, value.currency)}</p>
          </div>
          {change ? (
            <div>
              <p className="text-sm text-muted-foreground">Change</p>
              <p className={`flex items-center gap-1 text-2xl font-semibold tracking-tight ${positive ? "text-emerald-600" : "text-destructive"}`}>
                {positive ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {change}
              </p>
            </div>
          ) : null}
        </div>
        {value.summary ? <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{value.summary}</p> : null}
        <SourceLink title={value.sourceTitle} url={value.sourceUrl} />
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
      if (value?.kind === "pending") {
        return <SearchPendingCard subject={`Weather for ${value.location}`} />;
      }
      if (value) return <WeatherCard value={value} />;
      return <ErrorCard title="Weather unavailable" message="Tool returned invalid weather data." />;
    }
    const value = stockOutput(output);
    if (value?.kind === "pending") {
      return <SearchPendingCard subject={`Stock quote for ${value.symbol}`} />;
    }
    return value
      ? <StockCard value={value} />
      : <ErrorCard title="Stock price unavailable" message="Tool returned invalid stock data." />;
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
  const label = toolName === "displayWeather" ? "Fetching weather" : "Preparing stock quote";
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
