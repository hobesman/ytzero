import { describe, expect, test } from "bun:test";
import { audioPlayerClientArgs } from "./audioPlayerClient";

describe("audio lookup client", () => {
  const plugin = { YTDLP_BGUTIL_PLUGIN_DIR: "/plugins", YTDLP_BGUTIL_SERVER_HOME: "/bgutil" };

  test("asks for the mobile web client first when the token plugin is set up", () => {
    expect(audioPlayerClientArgs(false, plugin)).toEqual(["--extractor-args", "youtube:player_client=mweb,default"]);
  });

  test("keeps yt-dlp's own choice without the token plugin or with cookies", () => {
    expect(audioPlayerClientArgs(false, {})).toEqual([]);
    expect(audioPlayerClientArgs(false, { YTDLP_BGUTIL_PLUGIN_DIR: "/plugins" })).toEqual([]);
    expect(audioPlayerClientArgs(true, plugin)).toEqual([]);
  });
});
