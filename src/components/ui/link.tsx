import * as React from "react";
import { ExternalLink, PanelRightOpen } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openViewportForUser } from "@/features/viewport/viewportStore";
import { cn } from "@/lib/utils";

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  as?: React.ElementType;
  underline?: "none" | "hover" | "always";
  variant?: string;
};

type LinkContextMenuProps = {
  href: string;
  children: React.ReactElement;
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link({
  as,
  className,
  underline = "hover",
  variant: _variant,
  ...props
}, ref) {
  const Component = (as ?? "a") as React.ElementType;
  const link = (
    <Component
      ref={ref}
      className={cn(
        "text-primary underline-offset-4",
        underline === "always" && "underline",
        underline === "hover" && "hover:underline",
        className,
      )}
      {...props}
    />
  );
  if (!isHttpUrl(props.href) || Component !== "a") return link;

  return (
    <LinkContextMenu href={props.href}>
      {link}
    </LinkContextMenu>
  );
});

export function LinkContextMenu({ href, children }: LinkContextMenuProps) {
  const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>;
  const trigger = React.cloneElement(child, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      child.props.onClick?.(event);
      openMenuFromClick(event);
    },
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem
          onSelect={() => {
            void openInDefaultBrowser(href);
          }}
        >
          <ExternalLink />
          Open in Browser
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            void openViewportForUser(href).catch((error) =>
              console.warn("Failed to open link in viewport:", error),
            );
          }}
        >
          <PanelRightOpen />
          Open in Viewport
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function openMenuFromClick(event: React.MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2,
    clientX: event.clientX,
    clientY: event.clientY,
  }));
}

async function openInDefaultBrowser(href: string) {
  try {
    await openUrl(href);
    return;
  } catch (error) {
    console.warn("Failed to open link with Tauri opener:", error);
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function isHttpUrl(href: unknown): href is string {
  return typeof href === "string" && /^https?:\/\//i.test(href);
}
