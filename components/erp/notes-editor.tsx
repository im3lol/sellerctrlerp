"use client";

import { useRef } from "react";
import { Bold, Italic, List } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/**
 * A notes box that is actually a small editor: several lines, and a toolbar for the
 * three things a document note ever needs — bold, italic, bullets.
 *
 * It stores plain text with markdown-ish markers rather than HTML. That keeps the value
 * readable in the database, searchable, and safe to render (see `renderRichText`, which
 * builds React nodes and never injects markup). A full WYSIWYG editor would mean a new
 * dependency plus an HTML sanitiser on every read path, for a field that holds payment
 * terms and a delivery date.
 */
export function NotesEditor({
  value, onChange, placeholder, rows = 4, id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Put the caret back where the writer left it: a toolbar that steals focus and drops
  // you at position 0 is worse than no toolbar.
  const restore = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  /** Wrap the selection — or, with nothing selected, open the markers at the caret. */
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    onChange(value.slice(0, s) + marker + value.slice(s, e) + marker + value.slice(e));
    restore(s + marker.length, e + marker.length);
  };

  /** Turn the caret's line into a bullet. */
  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    if (/^\s*[-*]\s/.test(value.slice(lineStart))) return; // already one
    onChange(value.slice(0, lineStart) + "- " + value.slice(lineStart));
    restore(s + 2, s + 2);
  };

  // Buttons written out rather than built by a helper: handing a ref-reading closure to a
  // function called during render is what the React Compiler's `refs` rule flags. As a JSX
  // `onClick` it is plainly an event handler, which is what it is.
  const tool = "size-7";

  return (
    <div className="rounded-md border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <div className="flex items-center gap-0.5 border-b px-1 py-0.5">
        <Button type="button" size="icon" variant="ghost" className={tool} title="عريض" aria-label="عريض" onClick={() => wrap("**")}>
          <Bold className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className={tool} title="مائل" aria-label="مائل" onClick={() => wrap("*")}>
          <Italic className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className={tool} title="نقطة" aria-label="نقطة" onClick={bullet}>
          <List className="size-3.5" />
        </Button>
        <span className="ms-auto pe-2 text-[11px] text-muted-foreground">**عريض** · *مائل* · - نقطة</span>
      </div>
      <Textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-0 resize-y rounded-none border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
