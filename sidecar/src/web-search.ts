import { tool } from "ai";
import { z } from "zod";
import type { ChatCommand } from "./protocol";

export type SearchResult = {
  title: string;
  url: string;
  highlights: string[];
};

type SearchConfig = NonNullable<ChatCommand["webSearch"]>;

const truncate = (text: string) => text.trim().slice(0, 500);

async function readJson(response: Response): Promise<{ results?: Array<{
  title?: string;
  url?: string;
  content?: string;
  highlights?: string[];
}> }> {
  if (!response.ok) throw new Error(`Web search failed (${response.status})`);
  return response.json() as Promise<{
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      highlights?: string[];
    }>;
  }>;
}

function normalize(body: Awaited<ReturnType<typeof readJson>>): SearchResult[] {
  return (body.results ?? []).slice(0, 8).flatMap((item) => {
    if (!item.title || !item.url) return [];
    return [{
      title: item.title,
      url: item.url,
      highlights: (item.highlights ?? (item.content ? [item.content] : []))
        .slice(0, 2)
        .map(truncate),
    }];
  });
}

async function remoteSearch(
  query: string,
  config: SearchConfig,
  providerFetch: typeof fetch,
): Promise<SearchResult[]> {
  const endpoint = config.provider === "exa"
    ? "https://api.exa.ai/search"
    : config.provider === "tavily"
      ? "https://api.tavily.com/search"
      : "https://ollama.com/api/web_search";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.secret) {
    if (config.provider === "exa") headers["x-api-key"] = config.secret;
    else headers.authorization = `Bearer ${config.secret}`;
  }
  const body = config.provider === "exa"
    ? { query, type: "auto", num_results: 5, contents: { highlights: true } }
    : config.provider === "tavily"
      ? { query, search_depth: "basic", max_results: 5 }
      : { query, max_results: 5 };
  return normalize(await readJson(await providerFetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })));
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/<[^>]+>/g, "")
    .replace(/<|>/g, "")
    .trim();
}

async function localSearch(query: string, providerFetch: typeof fetch): Promise<SearchResult[]> {
  const response = await providerFetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "PolyUI local web search",
    },
    body: new URLSearchParams({ q: query }),
  });
  if (!response.ok) throw new Error(`Local web search failed (${response.status})`);
  const html = await response.text();
  const links = [...html.matchAll(
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g,
  )];
  return links.slice(0, 8).flatMap((match) => {
    try {
      const candidate = new URL(match[1], "https://duckduckgo.com");
      const redirected = candidate.searchParams.get("uddg");
      const url = redirected ? decodeURIComponent(redirected) : candidate.toString();
      return [{
        title: decodeHtml(match[2]),
        url,
        highlights: [truncate(decodeHtml(match[3]))],
      }];
    } catch {
      return [];
    }
  });
}

export async function searchWeb(
  query: string,
  config: SearchConfig,
  providerFetch: typeof fetch = fetch,
): Promise<SearchResult[]> {
  if (config.provider === "local") return localSearch(query, providerFetch);
  if (!config.secret) throw new Error(`${config.provider} web search key is not configured`);
  return remoteSearch(query, config, providerFetch);
}

export function createWebSearchTool(
  config: SearchConfig,
  providerFetch: typeof fetch = fetch,
) {
  return tool({
    description: "Search the web for current, factual information and return cited results.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(500),
    }),
    execute: async ({ query }) => ({
      query,
      results: await searchWeb(query, config, providerFetch),
    }),
  });
}
