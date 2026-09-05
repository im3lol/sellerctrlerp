"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { TablePaginationFooter } from "@/components/erp/table-pagination-footer";

/**
 * Drag-to-reorder + 10-per-page table body for a document's line-item editor. Renders
 * <TableRow>s directly — drop inside a <Table><TableBody> that already has the form's own
 * <TableHead>s (plus two extra head cells for the handle/reorder columns this adds).
 *
 * Drag only reorders within the visible page (dnd-kit's SortableContext is page-scoped);
 * the ▲▼ buttons move a row by one position across the full list, so a line can still
 * cross a page boundary without needing multi-container drag.
 */
export function SortableLineRows<T extends { id: string }>({
  items, onReorder, pageSize = 10, renderCells,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  pageSize?: number;
  /** The form's own <TableCell>s for this row (item picker, qty, price, …). */
  renderCells: (item: T, index: number) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);

  // Snap to the page holding the new row when a line is added; clamp back after a shrink.
  const prevLen = useRef(items.length);
  useEffect(() => {
    if (items.length > prevLen.current) setPage(Math.max(0, Math.ceil(items.length / pageSize) - 1));
    prevLen.current = items.length;
  }, [items.length, pageSize]);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);

  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    onReorder(arrayMove(items, from, to));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((it) => it.id === active.id);
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pageItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {pageItems.map((item, i) => {
            const realIndex = start + i;
            return (
              <SortableRow key={item.id} id={item.id} canUp={realIndex > 0} canDown={realIndex < items.length - 1}
                onUp={() => move(realIndex, realIndex - 1)} onDown={() => move(realIndex, realIndex + 1)}>
                {renderCells(item, realIndex)}
              </SortableRow>
            );
          })}
        </SortableContext>
      </DndContext>
      <TablePaginationFooter page={safePage} pages={pages} total={items.length} onChange={setPage} />
    </>
  );
}

function SortableRow({ id, canUp, canDown, onUp, onDown, children }: {
  id: string; canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined, position: "relative", zIndex: isDragging ? 1 : undefined };
  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-8 px-1">
        <Button type="button" variant="ghost" size="icon-xs" className="cursor-grab touch-none active:cursor-grabbing" aria-label="سحب لإعادة الترتيب" {...attributes} {...listeners}>
          <Icon name="GripVertical" className="size-4" />
        </Button>
      </TableCell>
      {children}
      <TableCell className="w-8 px-1">
        <div className="flex flex-col">
          <Button type="button" variant="ghost" size="icon-xs" disabled={!canUp} onClick={onUp} aria-label="نقل لأعلى"><Icon name="ChevronUp" className="size-3.5" /></Button>
          <Button type="button" variant="ghost" size="icon-xs" disabled={!canDown} onClick={onDown} aria-label="نقل لأسفل"><Icon name="ChevronDown" className="size-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
