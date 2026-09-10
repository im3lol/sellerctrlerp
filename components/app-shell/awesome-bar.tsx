"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { Icon } from "@/components/icon";
import { Input } from "@/components/ui/input";
import { NAV, type NavItem } from "@/components/app-shell/nav-config";
import { quickSearchAction, type QuickHit } from "@/app/actions/erp/quick-search";
import { cn } from "@/lib/utils";

/**
 * One search box for the whole system — pages and records together.
 *
 * There were two: one in the sidebar that found pages and one up here that found items,
 * customers and suppliers. Two boxes means remembering which one knows about what, so
 * they are one, split into sections the way ERPNext's Awesome Bar is.
 *
 * Pages resolve instantly from NAV on the client — no round trip for something we already
 * know. Records are debounced, because that half costs a query per keystroke.
 */

const KIND_LABEL: Record<QuickHit["kind"], string> = {
  item: "صنف",
  customer: "عميل",
  supplier: "مورّد",
};

function allowed(item: NavItem, perms: Set<string>): boolean {
  if (!item.capability) return true;
  // Only ERP grants are checked here; a platform-role page is left out rather than
  // offered to someone who may not open it.
  return item.capability.startsWith("erp.") && perms.has(item.capability.slice(4));
}

export function AwesomeBar({
  erpPermissions, modules, navHidden,
}: {
  erpPermissions: string[];
  modules?: string[];
  navHidden?: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<QuickHit[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(() => {
    const perms = new Set(erpPermissions);
    const hidden = new Set(navHidden ?? []);
    const out: { item: NavItem; heading: string }[] = [];
    for (const section of NAV) {
      if (section.heading && hidden.has(section.heading)) continue;
      if (section.moduleKey && modules && !modules.includes(section.moduleKey)) continue;
      for (const item of section.items) {
        if (allowed(item, perms)) out.push({ item, heading: section.heading ?? "" });
      }
    }
    return out;
  }, [erpPermissions, modules, navHidden]);

  const needle = q.trim().toLowerCase();
  const pageHits = needle
    ? pages.filter((p) => p.item.label.toLowerCase().includes(needle) || p.heading.toLowerCase().includes(needle)).slice(0, 6)
    : [];

  // Records are a query per keystroke, so wait for a pause. The page half above already
  // updated, which is why the box never feels like it is waiting.
  useEffect(() => {
    if (needle.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await quickSearchAction(needle);
        if (!cancelled) setHits(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [needle]);

  // `/` and Ctrl+K focus it, unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on an outside click — a dropdown that follows you around the page is worse
  // than one you have to dismiss.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  const full = () => { if (needle) go(`/search?q=${encodeURIComponent(q.trim())}`); };

  const nothing = needle.length >= 2 && !loading && pageHits.length === 0 && hits.length === 0;

  return (
    <div ref={boxRef} className="relative hidden w-full max-w-sm md:block" data-tour="topbar-search">
      <form onSubmit={(e) => { e.preventDefault(); full(); }} role="search">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); } }}
          placeholder="ابحث عن صفحة أو صنف أو عميل…  /"
          className="bg-muted/50 pr-9"
          aria-label="بحث"
        />
      </form>

      {open && needle.length > 0 && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
          {pageHits.length > 0 && (
            <Section title="الصفحات">
              {pageHits.map(({ item, heading }) => (
                <Row key={item.href} onClick={() => go(item.href)}>
                  <Icon name={item.icon} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {heading && <span className="shrink-0 text-xs text-muted-foreground">{heading}</span>}
                </Row>
              ))}
            </Section>
          )}

          {(hits.length > 0 || loading) && (
            <Section title="البيانات">
              {loading && hits.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />جارٍ البحث…
                </div>
              )}
              {hits.map((h) => (
                <Row key={`${h.kind}-${h.id}`} onClick={() => go(h.href)}>
                  <span className="min-w-0 flex-1 truncate">
                    {h.name ?? h.code}
                    {h.code && h.name && <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">{h.code}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[h.kind]}</span>
                </Row>
              ))}
            </Section>
          )}

          {nothing && <div className="px-3 py-6 text-center text-sm text-muted-foreground">مفيش نتائج لـ«{q.trim()}».</div>}

          <button
            type="button"
            onClick={full}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CornerDownLeft className="size-3.5" />
            بحث كامل عن «{q.trim()}»
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">{title}</div>
      {children}
    </div>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-accent")}
    >
      {children}
    </button>
  );
}
