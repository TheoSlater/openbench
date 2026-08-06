import { AlertTriangle, Search } from "lucide-react";
import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FeatureDef } from "@/lib/featureRegistry";

interface SlashCommandMenuProps {
  features: (FeatureDef & { active: boolean; warning?: string })[];
  onSelect: (feature: FeatureDef & { active: boolean; warning?: string }) => void;
  selectedIndex: number;
  slashQuery: string;
}

export function SlashCommandMenu({
  features,
  onSelect,
  selectedIndex,
  slashQuery,
}: SlashCommandMenuProps) {
  const query = slashQuery.toLowerCase().trim();
  const filtered = query
    ? features.filter((f) =>
        [f.name, f.id].some((field) =>
          field?.toLowerCase().includes(query),
        ),
      )
    : features;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="w-[min(calc(100vw-2rem),22rem)] overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-md">
        <Box className="max-h-72 overflow-y-auto overscroll-contain p-1">
          {filtered.length === 0 ? (
            <Box className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Search size={14} />
              <Typography variant="body2">
                No features match "{slashQuery}"
              </Typography>
            </Box>
          ) : (
            <Box className="flex flex-col gap-0.5" role="listbox">
              {filtered.map((feature, index) => {
                const Icon = feature.icon;
                const isSelected = index === selectedIndex;
                return (
                  <Box
                    key={feature.id}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected ? "true" : undefined}
                    className="group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-hidden select-none data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground hover:bg-muted/50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(feature);
                    }}
                  >
                    <Icon size={16} />
                    <span className="min-w-0 flex-1 truncate">
                      {feature.name}
                    </span>
                    {feature.warning ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="ml-2 flex shrink-0 items-center">
                              <AlertTriangle size={12} className="text-warning" />
                              </span>
                            }
                          />
                          <TooltipContent side="right">
                            {feature.warning}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : feature.active ? (
                      <Badge variant="secondary" className="ml-2 shrink-0">
                        On
                      </Badge>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </div>
    </div>
  );
}
