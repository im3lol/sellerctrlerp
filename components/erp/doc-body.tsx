import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a written doc (academy lesson body, release note) from markdown.
 *
 * react-markdown rather than a hand-rolled parser: markdown is not a few lines, and
 * the hand-rolled version ends up at dangerouslySetInnerHTML. This one never emits
 * raw HTML, so what the owner types can't become script — worth the dependency even
 * though only the platform owner writes this content today.
 *
 * remark-gfm buys tables and strikethrough. Without it a markdown table renders as
 * literal `| a | b |` text, and the editor hint promising tables would be a lie.
 *
 * Styled through the components map, not @tailwindcss/typography: a dozen classNames
 * beats another build-time plugin.
 */
const cls = {
  h1: "mt-6 text-xl font-bold first:mt-0",
  h2: "mt-6 text-lg font-semibold first:mt-0",
  h3: "mt-4 font-semibold",
  p: "leading-7 text-foreground/90",
  ul: "list-disc space-y-1 pr-5",
  ol: "list-decimal space-y-1 pr-5",
  code: "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
  pre: "overflow-x-auto rounded-lg bg-muted p-3 text-sm",
  blockquote: "border-r-2 border-primary/40 pr-3 text-muted-foreground",
  th: "border border-border bg-muted px-2 py-1 text-right font-semibold",
  td: "border border-border px-2 py-1",
};

/**
 * react-markdown hands each component an AST `node` alongside the real props.
 * Spreading it straight onto an element ships `node="[object Object]"` into the HTML,
 * so drop it here rather than at each of the dozen call sites below.
 */
const drop = <T extends object>({ node: _node, ...rest }: T & { node?: unknown }) => rest;

export function DocBody({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-sm" dir="rtl">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className={cls.h1} {...drop(p)} />,
          h2: (p) => <h2 className={cls.h2} {...drop(p)} />,
          h3: (p) => <h3 className={cls.h3} {...drop(p)} />,
          p: (p) => <p className={cls.p} {...drop(p)} />,
          ul: (p) => <ul className={cls.ul} {...drop(p)} />,
          ol: (p) => <ol className={cls.ol} {...drop(p)} />,
          code: (p) => <code className={cls.code} {...drop(p)} />,
          pre: (p) => <pre className={cls.pre} {...drop(p)} />,
          blockquote: (p) => <blockquote className={cls.blockquote} {...drop(p)} />,
          th: (p) => <th className={cls.th} {...drop(p)} />,
          td: (p) => <td className={cls.td} {...drop(p)} />,
          hr: () => <hr className="my-6 border-border" />,
          // A wide table must scroll inside itself; letting it stretch the card puts a
          // horizontal scrollbar on the whole page instead.
          table: (p) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...drop(p)} />
            </div>
          ),
          // Docs link out to videos and to pages elsewhere; an external link that
          // hijacks the tab loses whatever the reader was doing.
          a: ({ href, ...p }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-primary underline underline-offset-4" {...drop(p)} />
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={typeof src === "string" ? src : ""} alt={alt ?? ""}
              className="my-3 max-w-full rounded-lg border border-border" />
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
