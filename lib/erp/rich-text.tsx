import type { ReactNode } from "react";

/**
 * The read side of `<NotesEditor>`: turns a stored note back into formatted output,
 * on screen and on paper.
 *
 * The markers are a deliberately tiny subset of markdown — `**عريض**`, `*مائل*`, and
 * lines starting with `- ` — because a note is a paragraph of terms, not a document.
 * Everything is parsed into React nodes; nothing is ever handed to
 * `dangerouslySetInnerHTML`, so a note typed by a user (or pasted from a customer's
 * email) cannot carry markup into the page or the print sheet.
 *
 * Inline styles, not classes: the print sheet renders outside the app's stylesheet.
 */

/** `**عريض**` and `*مائل*` inside a single line. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] != null ? <b key={`${key}-${i}`}>{m[1]}</b> : <i key={`${key}-${i}`}>{m[2]}</i>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A stored note → paragraphs, bullet lists, and the line breaks as typed. */
export function renderRichText(text: string | null | undefined): ReactNode {
  if (!text?.trim()) return null;
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    const k = blocks.length;
    bullets = [];
    blocks.push(
      <ul key={`u${k}`} style={{ margin: "4px 0", paddingInlineStart: 18, listStyle: "disc" }}>
        {items.map((b, i) => <li key={i}>{inline(b, `u${k}-${i}`)}</li>)}
      </ul>,
    );
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    // `\s+` after the dash is what keeps `*مائل*` at the start of a line from being read
    // as a bullet — an italic marker is never followed by a space.
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b) { bullets.push(b[1]); continue; }
    flush();
    const k = blocks.length;
    // minHeight keeps a deliberately blank line as a blank line.
    blocks.push(<p key={`p${k}`} style={{ margin: 0, minHeight: "1em" }}>{inline(line, `p${k}`)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
