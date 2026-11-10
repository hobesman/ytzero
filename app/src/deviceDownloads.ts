import { database } from "./database";
import { enqueueDownload, removeDownload } from "./downloader";
import { isDownloadQuality } from "./downloadSettings";
import { log } from "./logger";

/**
 * "Download to your device": the server still has to fetch the video (yt-dlp
 * runs here), but the profile wants the file in its browser, not a server copy.
 * Such a request is an ordinary download whose ownership row carries the
 * source 'device'. Once the file has been sent to the browser in full, that
 * ownership is released; removeDownload keeps the physical file only while
 * another profile still owns it.
 *
 * A profile that already owns a server copy keeps it: the device request then
 * only queues the job if needed. Asking for a server copy later (any other
 * enqueue) overwrites the source, so the copy stays.
 */
export const DEVICE_DOWNLOAD_SOURCE = "device";

/** A finished device-only copy nobody fetched is released after this long. */
export const DEVICE_DOWNLOAD_UNCLAIMED_HOURS = 24;

const ownerSource = (userId: number, videoId: string) =>
  database.prepare("SELECT source FROM download_owners WHERE user_id=? AND video_id=?")
    .get(userId, videoId) as Promise<{ source: string } | null>;

/**
 * `quality` (one of the download qualities) sizes the file for the device, such
 * as 720p for a phone. A file the server already holds is handed over as it is.
 */
export async function enqueueDeviceDownload(userId: number, videoId: string, quality?: unknown): Promise<void> {
  const prior = await ownerSource(userId, videoId);
  await enqueueDownload(userId, videoId, "manual", false, false, isDownloadQuality(quality) ? { downloadQuality: quality } : {});
  if (prior && prior.source !== DEVICE_DOWNLOAD_SOURCE) return;
  await database.prepare("UPDATE download_owners SET source=? WHERE user_id=? AND video_id=?")
    .run(DEVICE_DOWNLOAD_SOURCE, userId, videoId);
}

/** Drop a device-only claim. A claim since upgraded to a server copy stays. */
export async function releaseDeviceDownload(userId: number, videoId: string): Promise<boolean> {
  if ((await ownerSource(userId, videoId))?.source !== DEVICE_DOWNLOAD_SOURCE) return false;
  await removeDownload(userId, videoId);
  log.info("downloads.device_released", { videoId, userId });
  return true;
}

/**
 * Body for GET /videos/:id/file. A device-only download is released when the
 * last byte has been read; an aborted transfer cancels the stream instead, so
 * the copy stays for another attempt (or the unclaimed sweep).
 */
export async function deviceFileResponse(userId: number, videoId: string, path: string, headers: Record<string, string>): Promise<Response> {
  const file = Bun.file(path);
  if ((await ownerSource(userId, videoId))?.source !== DEVICE_DOWNLOAD_SOURCE) return new Response(file, { headers });
  const body = file.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    flush: () => {
      releaseDeviceDownload(userId, videoId).catch((error) => log.warn("downloads.device_release_failed", { videoId, error: String(error) }));
    },
  }));
  return new Response(body, { headers: { ...headers, "Content-Length": String(file.size), "Cache-Control": "no-store" } });
}

export async function sweepUnclaimedDeviceDownloads(): Promise<number> {
  const rows = await database.prepare(`
    SELECT owner.user_id, owner.video_id FROM download_owners owner
    JOIN downloads d ON d.video_id=owner.video_id
    WHERE owner.source=? AND d.status='done' AND d.finished_at <= datetime('now', ?)
  `).all(DEVICE_DOWNLOAD_SOURCE, `-${DEVICE_DOWNLOAD_UNCLAIMED_HOURS} hours`) as { user_id: number; video_id: string }[];
  for (const row of rows) await releaseDeviceDownload(row.user_id, row.video_id);
  return rows.length;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startDeviceDownloadSweep(intervalMs = 60 * 60 * 1000) {
  if (sweepTimer) return;
  const run = () => sweepUnclaimedDeviceDownloads()
    .catch((error) => log.warn("downloads.device_sweep_failed", { error: String(error) }));
  run();
  sweepTimer = setInterval(run, intervalMs);
}
