// Words that mark an upload of a song rather than a different song.
const UPLOAD_NOISE = /\s*[([](?:official\s*(?:music\s*)?(?:video|audio|lyric(?:s)?\s*video|visualizer)|lyrics?(?:\s*video)?|audio|visuali[sz]er|hd|hq|4k|remastered(?:\s*\d{4})?|\d{4}\s*remaster(?:ed)?|explicit|clean|mv|m\/v|radio\s*edit|single\s*version|album\s*version|edit)[)\]]/gi;

/** "artist|title" shared by different uploads of one song (video, lyric video, Topic). */
export function songKey(artist: string, title: string): string {
  const cleanTitle = title
    .replace(UPLOAD_NOISE, "")
    .replace(/\s*[([](?:feat|ft)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:feat|ft)\.?\s.*$/i, "");
  // Music videos are often titled "Artist - Song".
  const leadArtist = artist.split(/,|&|\bx\b/i)[0].trim();
  const withoutArtist = leadArtist && cleanTitle.toLowerCase().startsWith(`${leadArtist.toLowerCase()} - `)
    ? cleanTitle.slice(leadArtist.length + 3)
    : cleanTitle;
  const normalize = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${normalize(leadArtist)}|${normalize(withoutArtist)}`;
}
