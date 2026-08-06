import { cn } from "@/lib/utils"

const variantClasses = {
  text: "rounded-sm",
  rounded: "rounded-md",
  circular: "rounded-full",
} as const

function Skeleton({
  className,
  variant,
  width,
  height,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: keyof typeof variantClasses
  width?: number | string
  height?: number | string
}) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse bg-muted",
        variant ? variantClasses[variant] : "rounded-2xl",
        className
      )}
      style={{ width, height, ...style }}
      {...props}
    />
  )
}

export { Skeleton }
