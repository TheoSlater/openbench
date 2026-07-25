import React from "react";
import { Globe } from "lucide-react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ui/reasoning";
import type { SearchResultItem } from "@/types/chat";
import { LinkContextMenu } from "@/components/ui/link";

const MAX_HIGHLIGHT_LENGTH = 160;

function truncateHighlight(text: string) {
  return text.length > MAX_HIGHLIGHT_LENGTH
    ? text.slice(0, MAX_HIGHLIGHT_LENGTH) + "…"
    : text;
}

interface WebSearchDisclosureProps {
  isSearching: boolean;
  query: string;
  results?: SearchResultItem[] | null;
  isExpanded: boolean;
  onToggle: () => void;
}

export const WebSearchDisclosure = React.memo(
  ({
    isSearching,
    query,
    results,
    isExpanded,
    onToggle,
  }: WebSearchDisclosureProps) => {
    const count = results?.length ?? 0;
    const hasResults = !isSearching && count > 0;

    if (!query.trim() && !isSearching && count === 0) return null;

    const label = isSearching
      ? `Searching for "${query}"…`
      : `Searched for "${query}"${hasResults ? ` · ${count} source${count === 1 ? "" : "s"}` : ""}`;

    return (
      <Reasoning
        open={isExpanded}
        onOpenChange={onToggle}
        isStreaming={isSearching}
        className="my-2"
      >
        <ReasoningTrigger>
          <span className="inline-flex items-center gap-1.5">
            <Globe size={14} />
            {isSearching ? (
              <TextShimmer as="span" duration={2} spread={15}>
                {label}
              </TextShimmer>
            ) : (
              label
            )}
          </span>
        </ReasoningTrigger>
        {hasResults && (
          <ReasoningContent>
            <div className="flex flex-col gap-2.5">
              {results?.map((result, i) => (
                <div key={`${result.url}-${i}`} className="flex flex-col gap-0.5">
                  <LinkContextMenu href={result.url}>
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-fit font-medium text-foreground hover:underline"
                    >
                      {result.title}
                    </a>
                  </LinkContextMenu>
                  {result.highlights?.map((highlight, j) => (
                    <span key={j} className="text-muted-foreground">
                      {truncateHighlight(highlight)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </ReasoningContent>
        )}
      </Reasoning>
    );
  },
);

WebSearchDisclosure.displayName = "WebSearchDisclosure";
