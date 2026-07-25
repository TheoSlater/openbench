import { useSidebar, SidebarTrigger } from "@/components/ui/sidebar";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/utils/platform";
import { PolyUiBrand } from "@/components/PolyUiBrand";
import { useReducedMotion } from "@/features/sidebar/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

export function SidebarBrand() {
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const inTitlebar = (IS_MAC || USE_CUSTOM_WINDOW_CONTROLS) && !isMobile;
  const reduceMotion = useReducedMotion();

  if (inTitlebar) return null;

  // The brand stays in the layout at every width and is clipped, rather than
  // being pulled out with `hidden`, which reflowed this row instantly on the
  // first frame while the panel was still animating. `inert` keeps the same
  // guarantee `hidden` gave: collapsed, the button is out of the keyboard flow
  // and the accessibility tree.
  //
  // The brand is flex-1 but capped by max-width, which is what actually eases:
  // 100% -> 0 as the panel collapses. A plain flex-1 would swallow all the free
  // space at every width, leaving the trigger pinned right instead of centred
  // in the rail. As the cap closes, free space opens up and the trigger's auto
  // margins carry it to the centre of the rail. One driver: the panel width.
  return (
    <div className="relative flex w-full items-center">
      <div
        className={cn(
          "min-w-0 flex-1 overflow-hidden",
          isCollapsed ? "max-w-0 opacity-0" : "max-w-full",
          !reduceMotion &&
            "transition-[max-width,opacity] duration-(--sidebar-transition-duration) ease-(--sidebar-transition-easing)",
        )}
        aria-hidden={isCollapsed}
        inert={isCollapsed}
      >
        <div className="w-max whitespace-nowrap">
          <PolyUiBrand />
        </div>
      </div>
      <SidebarTrigger className="mx-auto shrink-0" />
    </div>
  );
}
