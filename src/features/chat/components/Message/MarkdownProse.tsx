import { Children, isValidElement, memo, useMemo, useId, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import { Box } from "@/components/ui/Box";
import { Link } from "@/components/ui/link";
import { Typography } from "@/components/ui/Typography";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./CodeBlock";
import { parseProgressive } from "@/lib/chat/streamMarkdown";
import { isInlineMarkdownCode } from "@/lib/utils/markdownCode";
import { getMarkdownRenderBlocks } from "@/lib/chat/markdownRenderBlocks";

const ALERT_CONFIG = {
  note: { border: "info.main", bg: "info.soft" },
  tip: { border: "success.main", bg: "success.soft" },
  important: { border: "warning.main", bg: "warning.soft" },
  warning: { border: "warning.main", bg: "warning.soft" },
  caution: { border: "error.main", bg: "error.soft" },
} as const;

type AlertType = keyof typeof ALERT_CONFIG;

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function detectAlert(children: ReactNode): AlertType | null {
  const arr = Children.toArray(children);
  for (const child of arr) {
    if (isValidElement(child)) {
      const text = extractText((child.props as Record<string, unknown>)?.children).trim();
      const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (match) return match[1].toLowerCase() as AlertType;
    }
  }
  return null;
}

const HEADING_MARGINS: Record<string, { mt: number; mb: number }> = {
  h1: { mt: 3, mb: 1.5 },
  h2: { mt: 2.5, mb: 1.25 },
  h3: { mt: 2, mb: 1 },
  h4: { mt: 2, mb: 0.75 },
  h5: { mt: 1.5, mb: 0.5 },
  h6: { mt: 1.5, mb: 0.5 },
};

function createHeadingComponent(variant: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({ children }: { children?: ReactNode }) {
    const margins = HEADING_MARGINS[variant];
    return (
      <Typography
        variant={variant}
        style={{ marginTop: `${margins.mt * 8}px`, marginBottom: `${margins.mb * 8}px` }}
      >
        {children}
      </Typography>
    );
  };
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components,
  }: {
    content: string;
    components: Partial<Components>;
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content;
  },
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function normalizeContent(content: string): string {
  return content.replace(/<br\s*\/?>/gi, "\n");
}

export function MarkdownProse({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const id = useId();
  const normalized = useMemo(() => normalizeContent(content), [content]);
  const progressive = useMemo(
    () => streaming ? parseProgressive(normalized) : { safe: normalized, pending: false },
    [normalized, streaming],
  );
  const blocks = useMemo(
    () => getMarkdownRenderBlocks(progressive.safe, streaming),
    [progressive.safe, streaming],
  );
  const components = useMemo<Partial<Components>>(
    () => ({
      pre: ({ children }) => <>{children}</>,

      code({ className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || "");
        const codeValue = String(children).replace(/\n$/, "");
        const inline = isInlineMarkdownCode(className, children);
        if (!inline && match) {
          return <CodeBlock language={match[1]} code={codeValue} />;
        }
        if (!inline) {
          return <CodeBlock language={null} code={codeValue} />;
        }

        return (
          <Box
            as="code"
            className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            {...props}
          >
            {children}
          </Box>
        );
      },

      h1: createHeadingComponent("h1"),
      h2: createHeadingComponent("h2"),
      h3: createHeadingComponent("h3"),
      h4: createHeadingComponent("h4"),
      h5: createHeadingComponent("h5"),
      h6: createHeadingComponent("h6"),

      p: ({ children }) => (
        <Typography
          as="p"
          className="m-0"
        >
          {children}
        </Typography>
      ),

      ul: ({ children }) => (
        <Box as="ul" className="ml-5 list-disc">
          {children}
        </Box>
      ),

      ol: ({ children }) => (
        <Box as="ol" className="ml-5 list-decimal">
          {children}
        </Box>
      ),

      li: ({ children }) => (
        <Typography
          as="li"
          className="pl-1"
        >
          {children}
        </Typography>
      ),

      blockquote({ children }) {
        const alertType = detectAlert(children);
        if (alertType) {
          return (
            <Box
              className="rounded-lg border border-border/50 bg-muted/40 px-3 py-2"
            >
              {children}
            </Box>
          );
        }

        return (
          <Box
            as="blockquote"
            className="border-l border-border/60 pl-3 text-muted-foreground"
          >
            {children}
          </Box>
        );
      },

      a: ({ children, href }) => (
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </Link>
      ),

      table: ({ children }) => (
        <Box
          className="overflow-x-auto rounded-2xl border border-border/50"
        >
          <Box
            as="table"
            className="w-full border-collapse text-sm"
          >
            {children}
          </Box>
        </Box>
      ),

      img: ({ src, alt }) => (
        <Box
          as="img"
          src={src}
          alt={alt}
          className="max-w-full rounded-2xl border border-border/50"
        />
      ),

      hr: () => (
        <Box
          as="hr"
          className="border-border/50"
        />
      ),
    }),
    [],
  );

  return (
    <Box
      className="flex min-w-0 flex-col gap-3 text-sm leading-6 text-card-foreground"
    >
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${id}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
      {progressive.pendingCode && (
        <CodeBlock
          language={progressive.pendingCode.language}
          code={progressive.pendingCode.code}
        />
      )}
    </Box>
  );
}
