import type { CSSProperties, ReactNode } from "react";
import { Box } from "@/components/ui/Box";
import { ButtonBase } from "@/components/ui/button-base";
import { Skeleton } from "@/components/ui/skeleton";
import { Stack } from "@/components/ui/Stack";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { Typography } from "@/components/ui/Typography";
import { Check, Cpu, Eye, Link2 } from "lucide-react";
import type { OllamaModel } from "@/features/ollama";

export function ModelSelectorStatus({
  icon,
  text,
}: {
  icon?: ReactNode;
  text: string;
}) {
  return (
    <Box
      role="status"
      className="flex items-center gap-2 px-3 py-4"
    >
      {icon}
      <Typography>{text}</Typography>
    </Box>
  );
}

export function ModelSelectorOption({
  option,
  selected,
  highlighted,
  externalApiUrl,
  onHover,
  onSelect,
  style,
}: {
  option: OllamaModel;
  selected: boolean;
  highlighted: boolean;
  externalApiUrl: string;
  onHover: () => void;
  onSelect: () => void;
  style: CSSProperties;
}) {
  const external = option.provider_type === "OpenAICompatible";

  return (
    <ButtonBase
      as="div"
      role="option"
      aria-selected={selected}
      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-muted ${
        highlighted ? "bg-muted" : ""
      }`}
      onClick={onSelect}
      onMouseEnter={onHover}
      style={style}
    >
      <Box className="flex min-w-0 items-center gap-2">
        <Cpu size={15} />
        <Typography noWrap className="min-w-0">
          {option.name}
        </Typography>
        {external ? (
          <Tooltip title={`External API: ${externalApiUrl}`} arrow>
            <Box as="span">
              <Link2 size={13} />
            </Box>
          </Tooltip>
        ) : option.supports_vision ? (
          <Tooltip title="Supports vision" arrow>
            <Box as="span">
              <Eye size={13} />
            </Box>
          </Tooltip>
        ) : null}
      </Box>
      {selected ? <Check size={15} /> : null}
    </ButtonBase>
  );
}

export function ModelSelectorSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Stack role="status" aria-label="Loading models" spacing={0}>
      {Array.from({ length: count }, (_, index) => (
        <Box
          key={index}
        >
          <Skeleton variant="circular" width={15} height={15} />
          <Skeleton variant="rounded" width={`${48 + (index % 3) * 12}%`} height={14} />
        </Box>
      ))}
    </Stack>
  );
}
