/**
 * Volume levelling: a song plays turned down by how far it is above YouTube's
 * loudness target (`loudnessDb`, which the server passes on), as YouTube's own
 * players do. Quieter songs play as they are: turning them up could clip.
 */
export function levelledVolume(loudnessDb: number | null | undefined, enabled: boolean): number {
  if (!enabled || typeof loudnessDb !== "number" || !Number.isFinite(loudnessDb) || loudnessDb <= 0) return 1;
  return 10 ** (-Math.min(loudnessDb, 30) / 20);
}
