import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ApiError } from "../apiHttp";
import { roomApi, type AlexaRooms } from "./roomApi";
import { findRoom, pollDelay, roomFingerprint, settleControl, type PendingControl } from "./roomState";

export type RoomsSnapshot = { rooms: AlexaRooms; receivedAt: number };
/** `amount` is the volume asked for, or for a seek the place, in the progress bar's milliseconds. */
export type RoomCommand = (room: string, action: PendingControl["action"], run: () => Promise<unknown>, amount?: number) => Promise<string | null>;

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * Every room's state, polled while the page is visible, and the commands sent
 * from it. A command stays pending, per room, until the rooms list shows its
 * effect or it times out.
 */
export function useRooms(idle: boolean) {
  const visible = usePageVisible();
  const [snapshot, setSnapshot] = useState<RoomsSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [controls, setControls] = useState<Record<string, PendingControl>>({});
  const snapshotRef = useRef<RoomsSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const rooms = await roomApi.rooms();
      const next = { rooms, receivedAt: Date.now() };
      snapshotRef.current = next;
      setSnapshot(next);
      setOffline(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      else setOffline(true);
    } finally {
      setAttempt((count) => count + 1);
    }
  }, []);

  // Each answer (or failure) settles waiting commands against it.
  useEffect(() => {
    setControls((current) => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, PendingControl> = {};
      for (const [key, control] of Object.entries(current)) {
        const settled = settleControl(control, findRoom(snapshotRef.current?.rooms ?? null, key), now);
        if (settled) next[key] = settled;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [attempt]);

  const waiting = Object.keys(controls).length > 0;
  useEffect(() => {
    const delay = pollDelay({ visible, idle, waiting });
    if (delay === null) return;
    // The first answer comes at once; after that, one poll follows the last.
    const timer = window.setTimeout(() => void load(), attempt === 0 ? 0 : delay);
    return () => window.clearTimeout(timer);
  }, [attempt, idle, load, visible, waiting]);

  const command = useCallback<RoomCommand>(async (room, action, run, amount) => {
    const key = room.toLowerCase();
    const before = roomFingerprint(findRoom(snapshotRef.current?.rooms ?? null, room));
    setControls((current) => ({ ...current, [key]: { action, sentAt: Date.now(), ...(action === "volume" ? { volume: amount } : action === "seek" ? { target: amount } : {}), before } }));
    try {
      await run();
      void load();
      return null;
    } catch (error) {
      setControls((current) => {
        const { [key]: _removed, ...rest } = current;
        return rest;
      });
      return error instanceof Error ? error.message : String(error);
    }
  }, [load]);

  return { snapshot, offline, forbidden, controls, command, reload: load };
}

/** The time now, updated every `intervalMs` while `enabled`. */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

/** Pointer handlers that call `onLongPress` after the element is held for `ms`. */
export function useLongPress(onLongPress: () => void, ms = 1200) {
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      cancel();
      timer.current = window.setTimeout(() => { timer.current = null; onLongPress(); }, ms);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  };
}

/** Keeps the screen on while the page is visible, where the browser allows it. */
export function useScreenWakeLock(): void {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let live = true;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      wakeLock.request("screen").then((acquired) => {
        if (live) lock = acquired;
        else void acquired.release().catch(() => {});
      }, () => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** A wall tablet's browser session would end 30 days after sign-in; renewing it daily keeps it signed in. */
export function useSessionRenewal(): void {
  useEffect(() => {
    const renew = () => void roomApi.renewSession().catch(() => {});
    renew();
    const timer = window.setInterval(renew, 12 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
}
