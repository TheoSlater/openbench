import * as React from "react"

import { cn } from "@/lib/utils"

const TooltipProvider = ({ children, ...props }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props}>{children}</div>
)

const Tooltip = ({ children }: { children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLDivElement>(null)

  const show = () => setIsOpen(true)
  const hide = () => setIsOpen(false)

  return (
    <TooltipContext.Provider value={{ isOpen, show, hide }}>
      <div
        ref={triggerRef}
        onPointerEnter={show}
        onPointerLeave={hide}
        className="relative inline-flex"
      >
        {children}
      </div>
    </TooltipContext.Provider>
  )
}

const TooltipContext = React.createContext<{
  isOpen: boolean
  show: () => void
  hide: () => void
}>({ isOpen: false, show: () => {}, hide: () => {} })

const TooltipTrigger = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { disabled?: boolean }
>(({ className, disabled, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("inline-flex", className)}
    aria-disabled={disabled || undefined}
    {...props}
  />
))
TooltipTrigger.displayName = "TooltipTrigger"

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { side?: "top" | "bottom" | "left" | "right" }
>(({ className, side = "top", ...props }, ref) => {
  const { isOpen } = React.useContext(TooltipContext)

  if (!isOpen) return null

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 inline-flex items-center rounded-lg bg-popover border border-border px-2.5 py-1 text-xs text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95",
        sideClasses[side],
        className
      )}
      {...props}
    />
  )
})
TooltipContent.displayName = "TooltipContent"

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
