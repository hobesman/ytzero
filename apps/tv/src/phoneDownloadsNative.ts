/** Downloads to the phone need Android's DownloadManager; see phoneDownloadsNative.android.ts. */
export type NativeDownloadStatus = {
  id: string; status: "pending" | "running" | "paused" | "done" | "failed" | "missing";
  downloaded?: number; total?: number; waiting?: "wifi" | "network" | null; reason?: number | null;
};

export type NativeRangeResult = { status: number; size: number; total: number };

export type PhoneDownloadsNative = {
  directoryUri(): string;
  enqueue(url: string, headers: Record<string, string>, name: string, title: string, allowMetered: boolean): Promise<string>;
  query(ids: string[]): Promise<NativeDownloadStatus[]>;
  finish(id: string, name: string): Promise<number>;
  cancel(id: string): Promise<boolean>;
  fetchFile(url: string, headers: Record<string, string>, name: string): Promise<number>;
  /** Appends bytes [start, end] to "<name>.part" (music, which the server sends in ranges); status -1: no network. */
  fetchRange(url: string, headers: Record<string, string>, name: string, start: number, end: number): Promise<NativeRangeResult>;
  /** Renames a whole "<name>.part" to its final name; returns the size, or -1. */
  completePart(name: string): Promise<number>;
  /** Mobile data, or no network at all. */
  isMetered(): boolean;
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<boolean>;
  deleteFile(name: string): Promise<boolean>;
  fileSize(name: string): Promise<number>;
  freeBytes(): Promise<number>;
};

export const phoneDownloadsNative: PhoneDownloadsNative | null = null;
