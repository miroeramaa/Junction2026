"use client";

import { useEffect, useState } from "react";
import type { EventRow } from "@/lib/types";

const readStored = (key: string): Set<string> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
};

/** Read receipts stay on this browser; event IDs also handle delayed/out-of-order signals. */
export function useReadChanges(workspaceId: string, events: EventRow[], selected: string | null, allChanges: boolean, loading: boolean) {
  const key = `kestrel:read-changes:${workspaceId}`;
  const [state, setState] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  useEffect(() => {
    setState({ key, ids: readStored(key) });
    const sync = (event: StorageEvent) => {
      if (event.key !== key || event.storageArea !== localStorage) return;
      const stored = readStored(key);
      setState(old => ({ key, ids: new Set([...old.ids, ...stored]) }));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  useEffect(() => {
    if (state.key !== key || loading || (!selected && !allChanges)) return;
    const markViewed = () => {
      if (document.visibilityState !== "visible") return;
      const visible = events.filter(event => allChanges || event.competitor_id === selected);
      if (!visible.some(event => !state.ids.has(event.id))) return;
      const ids = new Set([...state.ids, ...readStored(key), ...visible.map(event => event.id)]);
      try { localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* Read state still works for this visit if storage is unavailable. */ }
      setState({ key, ids });
    };
    markViewed();
    document.addEventListener("visibilitychange", markViewed);
    return () => document.removeEventListener("visibilitychange", markViewed);
  }, [key, state, events, selected, allChanges, loading]);

  return (event: EventRow) => state.key === key && !state.ids.has(event.id);
}
