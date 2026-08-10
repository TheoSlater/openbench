import {
  createTerminalTool,
  ptyBroker,
  type PtyBroker,
  type TerminalStart,
} from "./terminal";
import {
  createWebSearchTool,
  type SearchConfig,
} from "./web-search";
import { createStockTool, createWeatherTool } from "./generative-tools";

const DEFAULT_TOOL_ORDER = [
  "web_search",
  "terminal",
  "displayWeather",
  "getStockPrice",
] as const;

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

type RuntimeToolName =
  | "web_search"
  | "terminal"
  | "displayWeather"
  | "getStockPrice";

export type ToolRegistryOptions = {
  webSearch?: SearchConfig;
  terminal?: boolean;
  fetch?: typeof fetch;
  terminalBroker?: PtyBroker;
  terminalStart?: TerminalStart;
  sandboxId?: string;
  generativeUI?: boolean;
  activeTools?: readonly string[];
  toolOrder?: readonly string[];
  toolChoice?: ToolChoice;
  terminalApproval?: "user-approval" | "not-applicable";
};

export function createToolRegistry(options: ToolRegistryOptions) {
  const webSearch = options.webSearch
    ? createWebSearchTool(options.webSearch, options.fetch)
    : undefined;
  const tools = {
    ...(webSearch ? { web_search: webSearch } : {}),
    ...(options.terminal
      ? {
        terminal: createTerminalTool({
          broker: options.terminalBroker ?? ptyBroker,
          onStart: options.terminalStart,
          sandboxId: options.sandboxId,
        }),
      }
      : {}),
    ...(options.generativeUI
      ? {
        displayWeather: createWeatherTool({ fetch: options.fetch }),
        getStockPrice: createStockTool(),
      }
      : {}),
  };
  const names = new Set(Object.keys(tools));

  if (
    options.toolChoice &&
    typeof options.toolChoice === "object" &&
    !names.has(options.toolChoice.toolName)
  ) {
    throw new Error(`Unknown tool: ${options.toolChoice.toolName}`);
  }

  const activeTools = options.activeTools
    ? [...new Set(options.activeTools)].filter((name): name is RuntimeToolName => names.has(name))
    : undefined;
  const requestedOrder = [...(options.toolOrder ?? DEFAULT_TOOL_ORDER)].filter(
    (name): name is RuntimeToolName => names.has(name),
  );
  const requestedNames = new Set<string>(requestedOrder);
  const toolOrder = [
    ...requestedOrder,
    ...Object.keys(tools).filter((name) => !requestedNames.has(name)).sort(),
  ] as RuntimeToolName[];
  const toolChoice = options.toolChoice && typeof options.toolChoice === "object"
    ? { ...options.toolChoice, toolName: options.toolChoice.toolName as RuntimeToolName }
    : options.toolChoice;

  return {
    tools,
    activeTools,
    toolOrder,
    toolChoice,
    toolApproval: "terminal" in tools
      ? { terminal: options.terminalApproval ?? "user-approval" }
      : undefined,
  };
}
