/**
 * Temporary on-device diagnostics for the Android phone probe, readable
 * without adb. Remove before this branch ships.
 */
export type DiagnosticEntry = { id: number; time: string; message: string };

const limit = 40;
let entries: DiagnosticEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function logDiagnostic(message: string) {
  const now = new Date();
  const time = `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  entries = [...entries.slice(-(limit - 1)), { id: nextId++, time, message }];
  console.info("[YT Zero diag]", message);
  listeners.forEach((listener) => listener());
}

export function diagnosticEntries(): readonly DiagnosticEntry[] { return entries; }

export function clearDiagnostics() {
  entries = [];
  listeners.forEach((listener) => listener());
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function describeError(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (cause && typeof cause === "object") {
    try { return JSON.stringify(cause).slice(0, 300); } catch { return String(cause); }
  }
  return String(cause);
}
