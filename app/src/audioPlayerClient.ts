/**
 * Which YouTube client yt-dlp asks for when it looks up a song's audio address.
 *
 * Without a sign-in, yt-dlp's default client is the TV client, and YouTube
 * refuses (403) most of the audio addresses it hands out; the server then
 * looks the song up again and again before playback can start. The mobile web
 * client works when it carries a proof-of-origin token, which only the bgutil
 * plugin supplies, so it goes first only when that plugin is set up. The
 * default clients stay behind it in case the mobile web lookup fails.
 */
export function audioPlayerClientArgs(useCookies: boolean, env: Record<string, string | undefined> = process.env): string[] {
  if (useCookies) return [];
  if (!env.YTDLP_BGUTIL_PLUGIN_DIR || !env.YTDLP_BGUTIL_SERVER_HOME) return [];
  return ["--extractor-args", "youtube:player_client=mweb,default"];
}
