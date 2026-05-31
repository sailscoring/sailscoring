'use client';

/**
 * Drag-and-drop reordering for vertical lists, wrapping dnd-kit so individual
 * sites don't repeat the sensor / context / modifier boilerplate. Presentation
 * only — persistence lives in each caller's `onReorder`, which receives the new
 * id order.
 *
 * Reordering by keyboard is preserved: focus a handle, press Space to pick up,
 * arrow keys to move, Space to drop (dnd-kit's KeyboardSensor).
 *
 * The render prop hands each item its sortable wiring; the caller owns the row
 * element and its classes (rows can carry per-row state styling) and drops a
 * `<DragHandle {...handleProps} />` wherever the grip belongs. Items for which
 * `isDisabled` returns true are not draggable and stay put.
 */

import type * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Wiring handed to each row via the render prop. */
export type SortableRenderProps = {
  /** Attach to the row element so dnd-kit can measure and move it. */
  ref: (node: HTMLElement | null) => void;
  /** Transform/transition for the row while dragging; spread onto `style`. */
  style: React.CSSProperties;
  /** Spread onto the `<DragHandle>` (or any grip) — pointer + keyboard listeners. */
  handleProps: React.HTMLAttributes<HTMLElement>;
  isDragging: boolean;
  /** Whether this row is non-draggable (per the list's `isDisabled`). */
  isDisabled: boolean;
};

/** What moved, for callers that reorder by index rather than by full id list. */
export type SortableMove = { activeId: string; fromIndex: number; toIndex: number };

export type SortableListProps<T extends { id: string }> = {
  items: T[];
  /** Called with the new id order (and the move details) after a drag or keyboard move settles. */
  onReorder: (orderedIds: string[], move: SortableMove) => void | Promise<void>;
  /** Rows for which this returns true are position-locked (not draggable). */
  isDisabled?: (item: T) => boolean;
  children: (item: T, props: SortableRenderProps) => React.ReactNode;
};

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  isDisabled,
  children,
}: SortableListProps<T>) {
  const sensors = useSensors(
    // A small drag threshold so a plain click/tap on the handle isn't read as a
    // drag (and so neighbouring buttons keep working).
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    void onReorder(arrayMove(items, oldIndex, newIndex).map((i) => i.id), {
      activeId: String(active.id),
      fromIndex: oldIndex,
      toIndex: newIndex,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <SortableRow
            key={item.id}
            id={item.id}
            disabled={isDisabled?.(item) ?? false}
          >
            {(props) => children(item, props)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (props: SortableRenderProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Keep the lifted row above its neighbours as it moves.
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? 'relative' : undefined,
  };
  return children({
    ref: setNodeRef,
    style,
    handleProps: { ...attributes, ...listeners },
    isDragging,
    isDisabled: disabled,
  });
}

/** Grip affordance for a sortable row. Spread the row's `handleProps` onto it. */
export function DragHandle({
  className,
  ...props
}: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      // touch-none stops the browser from scrolling instead of dragging on touch.
      className={cn(
        'shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded',
        className,
      )}
      {...props}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
