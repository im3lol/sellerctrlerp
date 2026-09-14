"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { confirm } from "@/components/erp/confirm";
import { moveOrderAction } from "@/app/actions/erp/kanban";
import { orderMove, ORDER_COLUMNS, type OrderKind } from "@/lib/erp/kanban-moves";
import type { ActionState } from "@/lib/erp/action-auth";
import { cn } from "@/lib/utils";

export type KanbanCard = {
  id: string; column: string; title: string;
  subtitle?: string | null; amount?: string; meta?: string; href?: string;
};
type Column = { key: string; label: string };
type Hint = "home" | "yes" | "no" | null;

/**
 * Cards in status columns. Dropping a card asks `why(from, to)` first — a reason means
 * no, and it is what the user reads — then runs `move`, and the card stays where it
 * landed only if that succeeds. Generic: orders and the hiring funnel each bring their
 * own rules and actions.
 *
 * Where a card sits is the server's data plus the moves made here (`moved`) — no copy of
 * the list in state, so a refresh from the server just flows in.
 */
export function KanbanBoard({ columns, cards, readOnly, why, move, askBefore }: {
  columns: Column[];
  cards: KanbanCard[];
  readOnly?: boolean;
  why: (from: string, to: string) => string | null;
  move: (id: string, from: string, to: string) => Promise<ActionState>;
  /** A move worth a second thought (cancelling, invoicing) — the question, or null. */
  askBefore?: (from: string, to: string) => string | null;
}) {
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const items = cards.map((c) => (moved[c.id] ? { ...c, column: moved[c.id] } : c));
  const active = items.find((c) => c.id === activeId) ?? null;
  const labelOf = (key: string) => columns.find((c) => c.key === key)?.label ?? key;

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const card = items.find((c) => c.id === e.active.id);
    const to = e.over ? String(e.over.id) : null;
    if (!card || !to || to === card.column) return;
    const from = card.column;
    const reason = why(from, to);
    if (reason) { toast.error(reason); return; }
    const question = askBefore?.(from, to);
    if (question && !(await confirm({ title: question, confirmText: "أيوه", danger: to === "CANCELLED" || to === "REJECTED" }))) return;

    setMoved((m) => ({ ...m, [card.id]: to }));
    start(async () => {
      const r = await move(card.id, from, to);
      if (r.error) {
        setMoved((m) => { const next = { ...m }; delete next[card.id]; return next; });
        toast.error(r.error);
      } else {
        toast.success(`${card.title}: ${labelOf(to)}`);
        router.refresh();
      }
    });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const inCol = items.filter((c) => c.column === col.key);
          const hint: Hint = !active ? null : active.column === col.key ? "home" : why(active.column, col.key) ? "no" : "yes";
          return (
            <Lane key={col.key} col={col} count={inCol.length} hint={hint}>
              {inCol.map((c) => <DraggableCard key={c.id} card={c} disabled={readOnly} />)}
            </Lane>
          );
        })}
      </div>
      <DragOverlay>{active ? <CardBody card={active} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function Lane({ col, count, hint, children }: { col: Column; count: number; hint: Hint; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors",
        hint === "yes" && "border-primary/50 bg-primary/5",
        hint === "no" && "opacity-50",
        isOver && hint === "yes" && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 text-sm font-semibold">
        <span>{col.label}</span>
        <span className="rounded-full bg-background px-2 text-xs tabular-nums text-muted-foreground">{count.toLocaleString("ar-EG-u-nu-latn")}</span>
      </div>
      <div className="flex max-h-[65vh] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  );
}

function DraggableCard({ card, disabled }: { card: KanbanCard; disabled?: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: card.id, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("outline-none", isDragging && "opacity-30")}>
      <CardBody card={card} draggable={!disabled} />
    </div>
  );
}

function CardBody({ card, lifted, draggable }: { card: KanbanCard; lifted?: boolean; draggable?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border bg-card p-3 text-sm shadow-sm",
      lifted ? "rotate-1 shadow-lg" : draggable && "cursor-grab hover:border-primary/40 active:cursor-grabbing",
    )}>
      <div className="flex items-start justify-between gap-2">
        {card.href ? (
          <Link href={card.href} onPointerDown={(e) => e.stopPropagation()} className="font-medium hover:text-primary hover:underline">
            {card.title}
          </Link>
        ) : (
          <span className="font-medium">{card.title}</span>
        )}
        {card.amount && <span className="shrink-0 font-medium tabular-nums">{card.amount}</span>}
      </div>
      {card.subtitle && <div className="mt-1 truncate text-muted-foreground">{card.subtitle}</div>}
      {card.meta && <div className="mt-1 text-xs text-muted-foreground">{card.meta}</div>}
    </div>
  );
}

/** Sales or purchase orders on a board — the moves are lib/erp/kanban-moves.ts. */
export function OrdersKanban({ kind, cards, canMove }: { kind: OrderKind; cards: KanbanCard[]; canMove: boolean }) {
  return (
    <KanbanBoard
      columns={ORDER_COLUMNS[kind]}
      cards={cards}
      readOnly={!canMove}
      why={(from, to) => (orderMove(kind, from, to) ? null : "النقلة دي مش من اللوحة — بتحصل من المستند نفسه (إذن صرف أو استلام أو فاتورة)")}
      move={(id, from, to) => moveOrderAction(kind, id, from, to)}
      askBefore={(_from, to) =>
        to === "CANCELLED" ? "إلغاء الأمر؟"
        : kind === "sales" && to === "INVOICED" ? "هنعمل فاتورة بيع مسودة من الأمر ده — تكمل؟"
        : null}
    />
  );
}
