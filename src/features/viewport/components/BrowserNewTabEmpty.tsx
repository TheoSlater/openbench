import { Globe2 } from "lucide-react";

export function BrowserNewTabEmpty() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="-mt-10 flex flex-col items-center">
        <Globe2 className="mb-8 size-20 text-muted-foreground" strokeWidth={1.7} />
        <div className="text-lg font-medium text-foreground">Start browsing</div>
        <div className="mt-3 text-base text-muted-foreground">Enter a URL or search with Google</div>
      </div>
    </div>
  );
}
