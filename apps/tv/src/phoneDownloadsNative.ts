/** Downloads to the phone need Android's DownloadManager; see phoneDownloadsNative.android.ts. */
export type NativeDownloadStatus = {
  id: string; status: "pending" | "running" | "paused" | "done" | "failed" | "missing";
  downloaded?: number; total?: number; waiting?: "wifi" | "network" | null; reason?: number | null;
};

export type PhoneDownloadsNative = {
  directoryUri(): string;
  enqueue(url: string, headers: Record<string, string>, name: string, title: string, allowMetered: boolean): Promise<string>;
  query(ids: string[]): Promise<NativeDownloadStatus[]>;
  finish(id: string, name: string): Promise<number>;
  cancel(id: string): Promise<boolean>;
  fetchFile(url: string, headers: Record<string, string>, name: string): Promise<number>;
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<boolean>;
  deleteFile(name: string): Promise<boolean>;
  fileSize(name: string): Promise<number>;
  freeBytes(): Promise<number>;
};

export const phoneDownloadsNative: PhoneDownloadsNative | null = null;
