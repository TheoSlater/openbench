import * as React from "react";
import { Box } from "@/components/ui/Box";
import { CircularProgress } from "@/components/ui/spinner";
import { Link } from "@/components/ui/link";
import { Typography } from "@/components/ui/Typography";
import { ExternalLink, FileText, Globe } from "lucide-react";
import { getRepository } from "@/lib/repositories";
import { useChatStore } from "@/store/chatStore";
import { useFolderStore } from "@/store/folderStore";
import type { Folder, SearchResultItem } from "@/types/chat";

type FolderSourcesProps = {
  folder: Folder;
};

type ContextSource = {
  id: string;
  name: string;
  size: number;
  folderName: string;
};

type WebSource = SearchResultItem & {
  count: number;
  folderNames: Set<string>;
};

function FolderChip({ name }: { name: string }) {
  return (
    <Box
      as="span"
      className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
    >
      {name}
    </Box>
  );
}

export function FolderSources({ folder }: FolderSourcesProps) {
  const folders = useFolderStore((state) => state.folders);
  const conversations = useChatStore((state) => state.conversations);
  const [webSources, setWebSources] = React.useState<WebSource[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const scopedFolders = React.useMemo(() => {
    const ids = new Set([folder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      folders.forEach((candidate) => {
        if (candidate.parentId && ids.has(candidate.parentId) && !ids.has(candidate.id)) {
          ids.add(candidate.id);
          changed = true;
        }
      });
    }
    return folders.filter((candidate) => ids.has(candidate.id));
  }, [folder.id, folders]);

  const contextSources = React.useMemo<ContextSource[]>(
    () => scopedFolders.flatMap((candidate) =>
      (candidate.contextFiles ?? []).map((file) => ({
        id: `${candidate.id}-${file.id}`,
        name: file.name,
        size: file.size,
        folderName: candidate.name,
      }))),
    [scopedFolders],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      setIsLoading(true);
      setError(null);
      try {
        const repo = await getRepository();
        const folderNames = new Map(scopedFolders.map((candidate) => [candidate.id, candidate.name]));
        const chats = conversations.filter((conversation) => conversation.folderId && folderNames.has(conversation.folderId));
        const chatFolderNames = new Map(chats.map((chat) => [chat.id, folderNames.get(chat.folderId ?? "")]));
        const messages = (await Promise.all(chats.map((chat) => repo.getMessages(chat.id, 99999, 0)))).flat();
        const byUrl = new Map<string, WebSource>();

        messages.forEach((message) => {
          const folderName = chatFolderNames.get(message.conversationId);
          if (!folderName) return;
          message.webSearch?.results?.forEach((result) => {
            const existing = byUrl.get(result.url);
            if (existing) {
              existing.count += 1;
              existing.folderNames.add(folderName);
              if (!existing.highlights?.length && result.highlights?.length) existing.highlights = result.highlights;
            } else {
              byUrl.set(result.url, { ...result, count: 1, folderNames: new Set([folderName]) });
            }
          });
        });

        if (!cancelled) setWebSources([...byUrl.values()]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadSources();
    return () => { cancelled = true; };
  }, [conversations, scopedFolders]);

  return (
    <Box className="flex flex-col gap-4">
      <Box>
        <Typography className="mb-1.5 text-sm font-semibold">Folder context</Typography>
        {scopedFolders.filter((candidate) => candidate.systemPrompt?.trim()).map((candidate) => (
          <Box key={`${candidate.id}-prompt`} className="mb-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
            <Box className="mb-0.5 flex items-center gap-1.5">
              <Typography className="flex-1 text-xs font-semibold">System prompt</Typography>
              <FolderChip name={candidate.name} />
            </Box>
            <Typography className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{candidate.systemPrompt}</Typography>
          </Box>
        ))}
        {contextSources.length === 0 ? (
          scopedFolders.some((candidate) => candidate.systemPrompt?.trim()) ? null : (
            <Typography className="text-xs text-muted-foreground">No folder context added.</Typography>
          )
        ) : contextSources.map((source) => (
          <Box key={source.id} className="flex items-center gap-2 border-b border-border py-1">
            <FileText size={16} className="shrink-0 text-muted-foreground" />
            <Typography className="min-w-0 flex-1 truncate text-sm">{source.name}</Typography>
            <FolderChip name={source.folderName} />
            <Typography className="text-xs text-muted-foreground">{Math.ceil(source.size / 1024)} KB</Typography>
          </Box>
        ))}
      </Box>

      <Box>
        <Typography className="mb-1.5 text-sm font-semibold">Web sources</Typography>
        {isLoading ? (
          <Box className="flex items-center gap-2 text-muted-foreground">
            <CircularProgress size={14} /><Typography className="text-xs">Loading sources...</Typography>
          </Box>
        ) : error ? (
          <Typography role="alert" className="text-xs text-destructive">Failed to load sources: {error}</Typography>
        ) : webSources.length === 0 ? (
          <Typography className="text-xs text-muted-foreground">No web sources used yet.</Typography>
        ) : webSources.map((source) => (
          <Box key={source.url} className="border-b border-border py-1.5">
            <Box className="flex items-center gap-1.5">
              <Globe size={14} className="shrink-0 text-muted-foreground" />
              <Link href={source.url} target="_blank" rel="noopener noreferrer" underline="hover" className="min-w-0 flex-1 text-sm font-semibold">
                {source.title || source.url} <ExternalLink size={12} className="inline" />
              </Link>
              {source.count > 1 ? <Typography className="text-xs text-muted-foreground">{source.count} uses</Typography> : null}
            </Box>
            {source.highlights?.[0] ? <Typography className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{source.highlights[0]}</Typography> : null}
            <Box className="mt-1.5 flex flex-wrap gap-0.5">
              {[...source.folderNames].map((name) => <FolderChip key={name} name={name} />)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
