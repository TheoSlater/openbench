import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

function CircularProgress({
  className,
  size = 16,
  color,
  ...props
}: React.ComponentProps<"svg"> & { size?: number | string; color?: string }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      width={size}
      height={size}
      color={color}
      className={cn("animate-spin", className)}
      {...props}
    />
  )
}

const Spinner = CircularProgress

export { CircularProgress, Spinner }
