// Global toast bus — any component can fire a toast without prop drilling.
// ToastHost (mounted once in AppShell) subscribes and renders them.

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Listener = (t: Toast) => void;

let listeners: Listener[] = [];
let nextId = 1;

export function onToast(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function toast(text: string, kind: ToastKind = "info"): void {
  const t: Toast = { id: nextId++, kind, text };
  for (const l of listeners) l(t);
}
