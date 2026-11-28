import { parseAudioContentRange } from "../audioRange";

type RangeFetcher = (range: string) => Promise<Response | null>;

/**
 * The whole audio file, for a request that names no range. The shared audio
 * proxy answers one with a 206 for the first piece only, which a browser
 * follows with further ranges. An Echo instead takes that piece for the whole
 * file: it stops where the piece ends (about 8½ minutes in) and can't seek, so
 * a resume plays from the start. This answers 200 with the file's full length,
 * reading the pieces from the proxy one after another as the Echo reads.
 */
export async function wholeAudioResponse(fetchRange: RangeFetcher, start = 0): Promise<Response | null> {
  const first = await fetchRange(`bytes=${start}-`);
  const firstRange = parseAudioContentRange(first?.headers.get("content-range") ?? null);
  // Failures and anything unexpected pass through as they are.
  if (!first?.body || first.status !== 206 || !firstRange || firstRange.start !== start) return first;
  const { total } = firstRange;
  let reader = first.body.getReader();
  let next = firstRange.end + 1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        if (next >= total) {
          controller.close();
          return;
        }
        const piece = await fetchRange(`bytes=${next}-`);
        const pieceRange = parseAudioContentRange(piece?.headers.get("content-range") ?? null);
        if (!piece?.body || piece.status !== 206 || !pieceRange || pieceRange.start !== next) {
          await piece?.body?.cancel().catch(() => {});
          controller.error(new Error("audio upstream did not return the rest of the file"));
          return;
        }
        next = pieceRange.end + 1;
        reader = piece.body.getReader();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  }, { highWaterMark: 0 });
  // From part way in (ffmpeg seeking in a processed stream), the rest of the file as one 206.
  return new Response(body, {
    status: start > 0 ? 206 : 200,
    headers: {
      "Content-Type": first.headers.get("content-type") ?? "audio/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(total - start),
      ...(start > 0 ? { "Content-Range": `bytes ${start}-${total - 1}/${total}` } : {}),
    },
  });
}
