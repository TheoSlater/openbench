import { cn } from "@/lib/utils";

export type ChainOfThoughtProps = React.HTMLAttributes<HTMLDivElement>;

export function ChainOfThought({ className, ...props }: ChainOfThoughtProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border/60 bg-card/70 px-3 py-2 text-xs text-muted-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export type ChainOfThoughtIconProps = React.HTMLAttributes<HTMLDivElement>;

export function ChainOfThoughtIcon({
  className,
  ...props
}: ChainOfThoughtIconProps) {
  return (
    <div
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70",
        className,
      )}
      {...props}
    />
  );
}

export type ChainOfThoughtTextProps = React.HTMLAttributes<HTMLDivElement>;

export function ChainOfThoughtText({
  className,
  ...props
}: ChainOfThoughtTextProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props} />
  );
}
