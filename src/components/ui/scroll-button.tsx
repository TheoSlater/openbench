"use client"

import { Button, buttonVariants } from "@/components/ui/button"
import { CircularProgress } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { type VariantProps } from "class-variance-authority"
import { ChevronDown } from "lucide-react"
import { useStickToBottomContext } from "use-stick-to-bottom"

export type ScrollButtonProps = {
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
  /** Show the spinner instead of the arrow while a reply streams. */
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>

function ScrollButton({
  className,
  variant = "outline",
  size = "sm",
  loading = false,
  ...props
}: ScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  return (
    <Button
      variant={variant}
      size={size}
      aria-label="Scroll to latest messages"
      className={cn(
        "group h-10 w-10 rounded-full transition-all duration-150 ease-out",
        !isAtBottom
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-4 scale-95 opacity-0",
        className
      )}
      onClick={() => scrollToBottom()}
      {...props}
    >
      {loading ? (
        <>
          <CircularProgress size={20} className="group-hover:hidden" />
          <ChevronDown className="hidden size-5 group-hover:block" />
        </>
      ) : (
        <ChevronDown className="size-5" />
      )}
    </Button>
  )
}

export { ScrollButton }
