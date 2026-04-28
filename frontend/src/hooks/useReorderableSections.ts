import { useMemo, useRef, useState, type DragEvent } from "react";
import { useUserPrefsStore } from "@/stores/userPrefsStore";

function reconcileOrder(saved: string[] | null, defaultOrder: string[]): string[] {
  if (!saved) return defaultOrder;

  const defaultSet = new Set(defaultOrder);
  const filtered = saved.filter((id) => defaultSet.has(id));
  const present = new Set(filtered);
  const appended = defaultOrder.filter((id) => !present.has(id));

  return [...filtered, ...appended];
}

export function useReorderableSections(storageKey: string, defaultOrder: string[]) {
  const persistedOrder = useUserPrefsStore(
    (state) => state.sectionOrder.orderByKey[storageKey] ?? null
  );
  const setSectionOrder = useUserPrefsStore((state) => state.setSectionOrder);

  const [order, setOrder] = useState<string[]>(() =>
    reconcileOrder(persistedOrder, defaultOrder)
  );

  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const dragHandlers = useMemo(
    () =>
      (sectionId: string) => ({
        draggable: true as const,
        onDragStart: (e: DragEvent) => {
          draggingIdRef.current = sectionId;
          setDraggingId(sectionId);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", sectionId);
        },
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (draggingIdRef.current && draggingIdRef.current !== sectionId) {
            setDragOverId(sectionId);
          }
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          const sourceId = draggingIdRef.current;
          if (!sourceId || sourceId === sectionId) {
            setDragOverId(null);
            return;
          }

          setOrder((prev) => {
            const sourceIndex = prev.indexOf(sourceId);
            const targetIndex = prev.indexOf(sectionId);
            if (sourceIndex === -1 || targetIndex === -1) return prev;

            const next = prev.filter((id) => id !== sourceId);
            const insertAt = next.indexOf(sectionId);
            next.splice(insertAt === -1 ? next.length : insertAt, 0, sourceId);
            setSectionOrder(storageKey, next);
            return next;
          });

          setDragOverId(null);
          setDraggingId(null);
          draggingIdRef.current = null;
        },
        onDragEnd: (_e: DragEvent) => {
          setDragOverId(null);
          setDraggingId(null);
          draggingIdRef.current = null;
        },
      }),
    [storageKey, setSectionOrder]
  );

  return { order, dragHandlers, dragOverId, draggingId };
}
