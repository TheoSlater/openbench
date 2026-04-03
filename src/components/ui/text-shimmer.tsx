import { cn } from "@/lib/utils"

export type TextShimmerProps = {
  as?: string
  duration?: number
  spread?: number
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>

export function TextShimmer({
  as = "span",
  className,
  duration = 4,
  spread = 20,
  children,
  ...props
}: TextShimmerProps) {
  const dynamicSpread = Math.min(Math.max(spread, 5), 45)
  const Component = as as React.ElementType

  return (
    <Component
      className={cn(
        "bg-clip-text font-medium text-transparent",
        "animate-shimmer",
        className
      )}
      style={{
        backgroundImage: `linear-gradient(to right, hsl(var(--muted-foreground)) ${50 - dynamicSpread}%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) ${50 + dynamicSpread}%)`,
        backgroundSize: "200% auto",
        animationDuration: `${duration}s`,
      }}
      {...props}
    >
      {children}
    </Component>
  )
}
