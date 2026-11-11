import { describe, expect, test } from "bun:test";
import type { VideoPlayer, VideoSource } from "expo-video";
import { PlaybackBuffer } from "./playbackBuffer";
import type { PlaybackTicket, Video } from "./types";

const video = (id: string) => ({ video_id: id, title: id, channel_title: "Channel", is_short: 1 } as Video);
const ticket = (id: string): PlaybackTicket => ({ ticket: id, url: "/media/" + id, content_type: "hls", expires_in: 60 });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

class FakePlayer {
  status = "idle";
  currentTime = 0;
  duration = 60;
  private speed = 1;
  playing = false;
  muted = false;
  get playbackRate() { return this.speed; }
  // expo-video on Apple sets AVPlayer.rate, even when assigning the same speed.
  set playbackRate(value: number) { this.speed = value; this.play(); }
  subtitleTrack: unknown = null;
  released = 0;
  autoReady = true;
  source: VideoSource | null = null;
  listeners = new Map<string, Set<(event: any) => void>>();
  addListener(name: string, fn: (event: any) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
    return { remove: () => { this.listeners.get(name)?.delete(fn); } };
  }
  emit(name: string, event: unknown) { this.listeners.get(name)?.forEach((fn) => fn(event)); }
  play() { this.playing = true; this.emit("playingChange", { isPlaying: true }); }
  pause() { this.playing = false; this.emit("playingChange", { isPlaying: false }); }
  tick(seconds: number) { if (this.playing) this.currentTime += seconds; }
  async replaceAsync(source: VideoSource | null) {
    this.source = source;
    if (!source) { this.status = "idle"; return; }
    this.emit("sourceLoad", { videoSource: source, duration: this.duration, availableSubtitleTracks: [{ language: "pl", id: "polish" }] });
    if (this.autoReady) this.becomeReady();
  }
  becomeReady() { this.status = "readyToPlay"; this.emit("statusChange", { status: this.status }); }
  release() { this.released++; }
}

function harness(defaultSpeed?: () => unknown) {
  const players: FakePlayer[] = [];
  const issued: string[] = [];
  const released: string[] = [];
  const failures: string[] = [];
  const control = { play: async (player: VideoPlayer) => { player.play(); }, pause: async (player: VideoPlayer) => { player.pause(); } };
  const api = {
    playbackTicket: async (id: string, _signal?: AbortSignal) => { issued.push(id); return ticket(id); },
    playbackSource: (value: PlaybackTicket) => ({ uri: "http://test.local" + value.url, contentType: value.content_type }),
    renewPlaybackTicket: async () => ({ expires_in: 60 }),
    releasePlaybackTicket: async (id: string) => { released.push(id); return { ok: true as const }; },
  };
  const pool = new PlaybackBuffer(api, () => {
    const player = new FakePlayer(); players.push(player); return player as unknown as VideoPlayer;
  }, async (player, seconds) => { player.currentTime = seconds; }, (entry) => failures.push(entry.video.video_id), undefined, control, defaultSpeed);
  return { pool, players, issued, released, failures, api, control };
}

describe("Shorts playback buffer", () => {
  test("live HLS accepts an indefinite duration and starts at the live edge instead of saved progress", async () => {
    for (const duration of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = harness();
      try {
        const entry = h.pool.prepare({ ...video("live"), is_short: 0, live_status: "live", watch_position: 120, watch_duration: 600 }, 120);
        h.players[0]!.duration = duration;
        await entry.ready;
        expect(entry.initialPosition).toBe(0);
        expect(h.players[0]!.currentTime).toBe(0);
        expect(h.failures).toEqual([]);
        expect(await h.pool.play(entry)).toBe(true);
      } finally { h.pool.dispose(); await flush(); }
    }
  });

  test("on-demand HLS still rejects a missing duration", async () => {
    const h = harness();
    try {
      const entry = h.pool.prepare(video("vod"));
      h.players[0]!.duration = 0;
      await expect(entry.ready).rejects.toThrow("Invalid playback duration");
    } finally { h.pool.dispose(); await flush(); }
  });

  test("preparing three Shorts never starts audio or advances their playback positions", async () => {
    const h = harness();
    try {
      const entries = ["previous", "current", "next"].map((id) => h.pool.prepare({ ...video(id), channel_playback_speed: "1.5" }));
      await Promise.all(entries.map((entry) => entry.ready));
      h.players.forEach((player) => player.tick(5));
      expect(h.players.map((player) => player.playing)).toEqual([false, false, false]);
      expect(h.players.map((player) => player.muted)).toEqual([true, true, true]);
      expect(h.players.map((player) => player.currentTime)).toEqual([0, 0, 0]);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("only the visible Short plays across repeated switches, including late native starts", async () => {
    const h = harness();
    try {
      const entries = ["previous", "current", "next"].map((id) => h.pool.prepare(video(id)));
      await Promise.all(entries.map((entry) => entry.ready));
      for (const index of [1, 2, 1, 0, 1, 2, 0, 2, 1]) {
        expect(await h.pool.play(entries[index]!)).toBe(true);
        const neighbour = (index + 1) % entries.length;
        h.players[neighbour]!.play();
        await flush();
        expect(h.players.map((player) => player.playing)).toEqual(entries.map((_, i) => i === index));
        expect(h.players.map((player) => player.muted)).toEqual(entries.map((_, i) => i !== index));
      }
      h.pool.dispose();
      expect(h.players.every((player) => player.muted && !player.playing)).toBe(true);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("closing while a native play command is in flight cannot bring back its audio", async () => {
    const h = harness();
    let completePlay!: () => void;
    h.control.play = async (player) => {
      await new Promise<void>((resolve) => { completePlay = resolve; });
      player.play();
    };
    try {
      const entry = h.pool.prepare(video("a"));
      await entry.ready;
      const starting = h.pool.play(entry);
      await flush();
      await h.pool.pause();
      completePlay();
      expect(await starting).toBe(false);
      expect(h.players[0]!.playing).toBe(false);
      expect(h.players[0]!.muted).toBe(true);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("a superseded native start never overlaps the newer selected Short", async () => {
    const h = harness();
    let completeFirst!: () => void;
    h.control.play = async (player) => {
      if (player === h.players[0] as unknown as VideoPlayer) await new Promise<void>((resolve) => { completeFirst = resolve; });
      player.play();
    };
    try {
      const a = h.pool.prepare(video("a"));
      const b = h.pool.prepare(video("b"));
      await Promise.all([a.ready, b.ready]);
      const oldStart = h.pool.play(a);
      await flush();
      expect(await h.pool.play(b)).toBe(true);
      completeFirst();
      expect(await oldStart).toBe(false);
      expect(h.players.map((player) => player.playing)).toEqual([false, true]);
      expect(h.players.map((player) => player.muted)).toEqual([true, false]);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("preserves the native failure for diagnostics instead of replacing it with a generic error", async () => {
    const h = harness();
    try {
      const entry = h.pool.prepare(video("a"));
      h.players[0]!.autoReady = false;
      await flush();
      const error = { message: "Network connection lost", code: "native-error" };
      h.players[0]!.emit("statusChange", { status: "error", error });
      await expect(entry.ready).rejects.toEqual(error);
      expect(entry.error).toBe(error);
      expect(h.failures).toEqual(["a"]);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("reuses already buffered neighbours without issuing another ticket or enabling disk cache", async () => {
    const h = harness();
    try {
      const a = h.pool.prepare(video("a"));
      const b = h.pool.prepare(video("b"));
      await Promise.all([a.ready, b.ready]);
      expect(h.pool.prepare(video("b"))).toBe(b);
      expect(h.issued).toEqual(["a", "b"]);
      expect(h.players[1]!.source).toMatchObject({ contentType: "hls", useCaching: false });
      expect(h.players[1]!.currentTime).toBe(0);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("source metadata alone is insufficient: waits until the native player is ready", async () => {
    const h = harness();
    try {
      const entry = h.pool.prepare(video("a"));
      h.players[0]!.autoReady = false;
      let ready = false;
      void entry.ready.then(() => { ready = true; });
      await flush();
      expect(ready).toBe(false);
      h.players[0]!.becomeReady();
      await entry.ready;
      expect(ready).toBe(true);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("retains only the active player and neighbours, releasing tickets and native players once", async () => {
    const h = harness();
    const entries = ["a", "b", "c"].map((id) => h.pool.prepare(video(id)));
    await Promise.all(entries.map((entry) => entry.ready));
    h.pool.retain(["b", "c"]);
    await flush();
    expect(h.released).toEqual(["a"]);
    expect(h.players.map((player) => player.released)).toEqual([1, 0, 0]);
    h.pool.dispose(); h.pool.dispose();
    await flush();
    expect(h.released).toEqual(["a", "b", "c"]);
    expect(h.players.map((player) => player.released)).toEqual([1, 1, 1]);
    expect(h.players.every((player) => [...player.listeners.values()].every((listeners) => !listeners.size))).toBe(true);
  });

  test("closing during ticket preparation aborts the request and releases a late authorization", async () => {
    const h = harness();
    let resolve!: (ticket: PlaybackTicket) => void;
    let signal: AbortSignal | undefined;
    h.api.playbackTicket = (_id, received) => { signal = received; return new Promise((done) => { resolve = done; }); };
    const entry = h.pool.prepare(video("late"));
    h.pool.dispose();
    expect(signal!.aborted).toBe(true);
    resolve(ticket("late"));
    await expect(entry.ready).rejects.toThrow("released");
    await flush();
    expect(h.released).toEqual(["late"]);
    expect(h.players[0]!.source).toBeNull();
    expect(h.players[0]!.released).toBe(1);
    expect(h.failures).toEqual([]);
  });

  test("a failed speculative neighbour can be retried without replacing the current player", async () => {
    const h = harness();
    try {
      const current = h.pool.prepare(video("a"));
      await current.ready;
      const failed = h.pool.prepare(video("b"));
      h.players[1]!.duration = 0;
      await expect(failed.ready).rejects.toThrow("duration");
      const retry = h.pool.prepare(video("b"));
      await retry.ready;
      expect(retry).not.toBe(failed);
      expect(h.pool.prepare(video("a"))).toBe(current);
      expect(h.failures).toEqual(["b"]);
      expect(h.issued).toEqual(["a", "b", "b"]);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("preloads at the resume position with channel speed and captions", async () => {
    const h = harness();
    try {
      const entry = h.pool.prepare({ ...video("a"), watch_position: 20, watch_duration: 60, channel_playback_speed: "1.5", channel_caption_language: "pl" });
      await entry.ready;
      expect(entry.player.currentTime).toBe(20);
      expect(entry.player.playing).toBe(false);
      await h.pool.play(entry);
      expect(entry.player.playbackRate).toBe(1.5);
      expect(entry.player.subtitleTrack).toMatchObject({ language: "pl" });
      // A speed chosen in AVKit is retained when returning to this buffer.
      entry.player.playbackRate = 2;
      await h.pool.pause();
      await h.pool.play(entry);
      expect(entry.player.playbackRate).toBe(2);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("uses the profile's default speed, read at playback, unless the channel has its own", async () => {
    let profileSpeed: unknown = "1.25";
    const h = harness(() => profileSpeed);
    try {
      const plain = h.pool.prepare(video("a"));
      const channel = h.pool.prepare({ ...video("b"), channel_playback_speed: "2" });
      const live = h.pool.prepare({ ...video("c"), is_short: 0, live_status: "live" });
      await Promise.all([plain.ready, channel.ready, live.ready]);
      profileSpeed = "1.75";
      await h.pool.play(plain);
      expect(plain.player.playbackRate).toBe(1.75);
      await h.pool.play(channel);
      expect(channel.player.playbackRate).toBe(2);
      await h.pool.play(live);
      expect(live.player.playbackRate).toBe(1);
      profileSpeed = "fast";
      const invalid = h.pool.prepare(video("d"));
      await invalid.ready;
      await h.pool.play(invalid);
      expect(invalid.player.playbackRate).toBe(1);
    } finally { h.pool.dispose(); await flush(); }
  });

  test("does not release a native player in the middle of replacing its source", async () => {
    const h = harness();
    let finishReplacement!: () => void;
    const entry = h.pool.prepare(video("a"));
    h.players[0]!.replaceAsync = (source) => source ? new Promise<void>((done) => { finishReplacement = done; }) : Promise.resolve();
    await flush();
    h.pool.dispose();
    await flush();
    expect(h.players[0]!.released).toBe(0);
    expect(h.released).toEqual([]);
    finishReplacement();
    await expect(entry.ready).rejects.toThrow("released");
    await flush();
    expect(h.players[0]!.released).toBe(1);
    expect(h.released).toEqual(["a"]);
  });

  test("a stale adjacency update cannot dispose either end of a pending swap", async () => {
    const h = harness();
    const a = h.pool.prepare(video("a"));
    const b = h.pool.prepare(video("b"));
    await Promise.all([a.ready, b.ready]);
    const unprotect = h.pool.protect(["a", "b"]);
    h.pool.retain(["a", "c"]);
    h.pool.retain(["b", "d"]);
    await flush();
    expect(h.released).toEqual([]);
    expect(h.pool.prepare(video("b"))).toBe(b);
    unprotect(); unprotect();
    h.pool.retain(["b"]);
    await flush();
    expect(h.released).toEqual(["a"]);
    h.pool.dispose(); await flush();
    expect(h.released).toEqual(["a", "b"]);
  });

  test("repeated forward/back swaps drain all players and revoke only detached sources", async () => {
    const h = harness();
    const releaseTicket = h.api.releasePlaybackTicket;
    h.api.releasePlaybackTicket = async (id) => {
      expect(h.players.filter((player) => player.released === 0).every((player) => player.source === null || (player.source as { uri: string }).uri !== "http://test.local/media/" + id)).toBe(true);
      return releaseTicket(id);
    };
    for (let i = 0; i < 20; i++) {
      const a = h.pool.prepare(video(String(i)));
      const b = h.pool.prepare(video(String(i + 1)));
      await Promise.all([a.ready, b.ready]);
      const unprotect = h.pool.protect([String(i), String(i + 1)]);
      h.pool.retain([]);
      unprotect();
      h.pool.retain([String(i + 1)]);
      await flush();
    }
    h.pool.dispose(); await flush();
    expect(h.released).toHaveLength(21);
    expect(h.players.every((player) => player.released === 1)).toBe(true);
  });
});

describe("full-quality stream fallback", () => {
  test("a failed direct HLS stream switches once to the progressive stream at the same position", async () => {
    const h = harness();
    const prefers: Array<string | undefined> = [];
    h.api.playbackTicket = async (id: string, _signal?: AbortSignal, prefer?: "progressive") => {
      prefers.push(prefer);
      return prefer
        ? { ticket: `${id}-progressive`, url: `/api/videos/${id}/direct-stream`, content_type: "progressive", expires_in: 60 }
        : { ticket: id, url: `/api/videos/${id}/direct-hls/index.m3u8`, content_type: "hls", expires_in: 60 };
    };
    try {
      const entry = h.pool.prepare({ ...video("hq"), is_short: 0 }, 0);
      await entry.ready;
      expect(await h.pool.play(entry)).toBe(true);
      const player = h.players[0]!;
      player.currentTime = 42;
      player.emit("statusChange", { status: "error", error: new Error("Source error Response code: 502") });
      await flush(); await flush();
      expect(prefers).toEqual([undefined, "progressive"]);
      expect(String((player.source as { uri: string }).uri)).toContain("/direct-stream");
      expect(player.currentTime).toBe(42);
      expect(player.playing).toBe(true);
      expect(h.failures).toEqual([]);
      expect(h.released).toContain("hq");
      // A second refusal, on the progressive stream, is a real failure.
      player.emit("statusChange", { status: "error", error: new Error("Source error Response code: 403") });
      await flush();
      expect(h.failures).toEqual(["hq"]);
    } finally { h.pool.dispose(); await flush(); }
  });
});

describe("stream quality", () => {
  test("asks for the chosen quality and reloads at the same position when it changes", async () => {
    const h = harness();
    let quality = "auto";
    const requested: Array<string | undefined> = [];
    h.api.playbackTicket = async (id: string, _signal?: AbortSignal, _prefer?: "progressive", asked?: string) => {
      requested.push(asked);
      return { ticket: `${id}-${requested.length}`, url: `/api/videos/${id}/direct-hls/index.m3u8?q=${asked}`, content_type: "hls", expires_in: 60 };
    };
    const pool = new PlaybackBuffer(h.api, () => {
      const player = new FakePlayer(); h.players.push(player); return player as unknown as VideoPlayer;
    }, async (player, seconds) => { player.currentTime = seconds; }, (entry) => h.failures.push(entry.video.video_id), undefined, h.control, undefined, () => quality);
    try {
      const entry = pool.prepare({ ...video("q"), is_short: 0 }, 0);
      await entry.ready;
      expect(await pool.play(entry)).toBe(true);
      const player = h.players[0]!;
      player.currentTime = 30;
      quality = "480";
      entry.reload();
      await flush(); await flush();
      expect(requested).toEqual(["auto", "480"]);
      expect(String((player.source as { uri: string }).uri)).toContain("q=480");
      expect(player.currentTime).toBe(30);
      expect(player.playing).toBe(true);
      // The first stream's ticket is released once the new one is in place.
      expect(h.released).toEqual(["q"]);
      expect(h.failures).toEqual([]);
    } finally { pool.dispose(); await flush(); }
  });

  test("fast start asks for the progressive stream first, and switching away reloads the full-quality one", async () => {
    const h = harness();
    let quality = "fast";
    const asked: Array<[string | undefined, string | undefined]> = [];
    h.api.playbackTicket = async (id: string, _signal?: AbortSignal, prefer?: "progressive", requested?: string) => {
      asked.push([prefer, requested]);
      return prefer
        ? { ticket: `${id}-${asked.length}`, url: `/api/videos/${id}/direct-stream`, content_type: "progressive", expires_in: 60 }
        : { ticket: `${id}-${asked.length}`, url: `/api/videos/${id}/direct-hls/index.m3u8?q=${requested}`, content_type: "hls", expires_in: 60 };
    };
    const pool = new PlaybackBuffer(h.api, () => {
      const player = new FakePlayer(); h.players.push(player); return player as unknown as VideoPlayer;
    }, async (player, seconds) => { player.currentTime = seconds; }, (entry) => h.failures.push(entry.video.video_id), undefined, h.control, undefined, () => quality);
    try {
      const entry = pool.prepare({ ...video("f"), is_short: 0 }, 0);
      await entry.ready;
      expect(asked).toEqual([["progressive", undefined]]);
      const player = h.players[0]!;
      expect(String((player.source as { uri: string }).uri)).toContain("/direct-stream");
      quality = "auto";
      entry.reload();
      await flush(); await flush();
      expect(asked).toEqual([["progressive", undefined], [undefined, "auto"]]);
      expect(String((player.source as { uri: string }).uri)).toContain("/direct-hls/");
      expect(h.failures).toEqual([]);
    } finally { pool.dispose(); await flush(); }
  });

  test("fast start leaves a live stream on its own source", async () => {
    const h = harness();
    const prefers: Array<string | undefined> = [];
    h.api.playbackTicket = async (id: string, _signal?: AbortSignal, prefer?: "progressive") => {
      prefers.push(prefer);
      return { ticket: id, url: `/api/videos/${id}/live-hls/index.m3u8`, content_type: "hls", expires_in: 60 };
    };
    const pool = new PlaybackBuffer(h.api, () => {
      const player = new FakePlayer(); h.players.push(player); return player as unknown as VideoPlayer;
    }, async (player, seconds) => { player.currentTime = seconds; }, (entry) => h.failures.push(entry.video.video_id), undefined, h.control, undefined, () => "fast");
    try {
      pool.prepare({ ...video("live"), live_status: "live" }, 0);
      await flush(); await flush();
      expect(prefers).toEqual([undefined]);
    } finally { pool.dispose(); await flush(); }
  });
});

describe("forward buffer", () => {
  test("only the playing video gets the long buffer, and it moves with the selection", async () => {
    const h = harness();
    let seconds = 120;
    const pool = new PlaybackBuffer(h.api, () => {
      const player = new FakePlayer(); h.players.push(player); return player as unknown as VideoPlayer;
    }, async (player, value) => { player.currentTime = value; }, (entry) => h.failures.push(entry.video.video_id), undefined, h.control, undefined, undefined,
    (active) => ({ preferredForwardBufferDuration: active ? seconds : 5 }));
    const buffered = () => h.players.map((player) => (player as unknown as { bufferOptions?: { preferredForwardBufferDuration?: number } }).bufferOptions?.preferredForwardBufferDuration);
    try {
      const entries = ["a", "b", "c"].map((id) => pool.prepare(video(id)));
      await Promise.all(entries.map((entry) => entry.ready));
      await pool.play(entries[1]!);
      expect(buffered()).toEqual([5, 120, 5]);
      await pool.play(entries[2]!);
      expect(buffered()).toEqual([5, 5, 120]);
      seconds = 30;
      pool.refreshBuffers();
      expect(buffered()).toEqual([5, 5, 30]);
    } finally { pool.dispose(); await flush(); }
  });
});

describe("playback ticket renewal", () => {
  // Captures the buffer's timers so the test fires them on demand.
  const realTimers = { setInterval: globalThis.setInterval, setTimeout: globalThis.setTimeout };
  const intervals: Array<() => void> = [];
  const timeouts: Array<{ fn: () => void; ms: number }> = [];
  const capture = () => {
    intervals.length = 0;
    timeouts.length = 0;
    globalThis.setInterval = ((fn: () => void) => { intervals.push(fn); return 0; }) as unknown as typeof setInterval;
    globalThis.setTimeout = ((fn: () => void, ms: number) => { timeouts.push({ fn, ms }); return 0; }) as unknown as typeof setTimeout;
  };
  const restore = () => Object.assign(globalThis, realTimers);

  test("a playing video that runs out of buffer offline reloads the same stream where it stopped once the network returns", async () => {
    const h = harness();
    const prefers: Array<string | undefined> = [];
    let online = true;
    h.api.playbackTicket = async (id: string, _signal?: AbortSignal, prefer?: "progressive") => {
      prefers.push(prefer);
      if (!online) throw new TypeError("Network request failed");
      return { ticket: `${id}-${prefers.length}`, url: `/api/videos/${id}/direct-hls/index.m3u8`, content_type: "hls", expires_in: 60 };
    };
    capture();
    try {
      const entry = h.pool.prepare({ ...video("tunnel"), is_short: 0 }, 0);
      await entry.ready;
      expect(await h.pool.play(entry)).toBe(true);
      const player = h.players[0]!;
      player.currentTime = 45;
      online = false;
      // ExoPlayer stalls, then gives up on the unanswered segment requests.
      player.status = "loading";
      player.emit("statusChange", { status: "loading" });
      player.playing = false;
      player.emit("playingChange", { isPlaying: false });
      player.emit("statusChange", { status: "error", error: new Error("A playback exception has occurred: Source error Unable to connect") });
      await flush();
      expect(h.failures).toEqual([]);
      // Still offline: it keeps trying, a little less often each time.
      timeouts.at(-1)!.fn();
      await flush();
      expect(timeouts.at(-1)!.ms).toBe(2000);
      expect(h.failures).toEqual([]);
      online = true;
      timeouts.at(-1)!.fn();
      await flush(); await flush();
      // The same full-quality stream, not the progressive fallback.
      expect(prefers).toEqual([undefined, undefined, undefined, undefined]);
      expect(String((player.source as { uri: string }).uri)).toContain("/direct-hls/");
      expect(player.currentTime).toBe(45);
      expect(player.playing).toBe(true);
      expect(h.failures).toEqual([]);
      expect(h.released).toEqual(["tunnel"]);
    } finally { restore(); h.pool.dispose(); await flush(); }
  });

  test("a video the viewer paused reloads after a dropped connection without starting by itself", async () => {
    const h = harness();
    capture();
    try {
      const entry = h.pool.prepare(video("paused"));
      await entry.ready;
      expect(await h.pool.play(entry)).toBe(true);
      const player = h.players[0]!;
      player.currentTime = 30;
      player.pause();
      player.emit("statusChange", { status: "error", error: new Error("Source error Unable to connect") });
      await flush(); await flush();
      expect(h.issued).toEqual(["paused", "paused"]);
      expect(player.currentTime).toBe(30);
      expect(player.playing).toBe(false);
      expect(h.failures).toEqual([]);
    } finally { restore(); h.pool.dispose(); await flush(); }
  });

  test("a dropped connection keeps playing and retries; a refused renewal asks for a new ticket, and a refused ticket ends playback", async () => {
    const h = harness();
    const renewals: string[] = [];
    let answer: () => Promise<{ expires_in: number }> = () => Promise.reject(new TypeError("Network request failed"));
    h.api.renewPlaybackTicket = async (_id?: string, value?: string) => { renewals.push(String(value)); return answer(); };
    capture();
    try {
      const entry = h.pool.prepare(video("wifi"));
      await entry.ready;
      expect(intervals.length).toBe(1);
      intervals[0]!();
      await flush();
      expect(h.failures).toEqual([]);
      const retry = timeouts.at(-1)!;
      expect(retry.ms).toBe(10_000);
      retry.fn();
      await flush();
      expect(renewals).toEqual(["wifi", "wifi"]);
      expect(h.failures).toEqual([]);
      answer = () => Promise.reject(Object.assign(new Error("expired media ticket"), { status: 401 }));
      timeouts.at(-1)!.fn();
      await flush(); await flush();
      expect(h.issued).toEqual(["wifi", "wifi"]);
      expect(h.failures).toEqual([]);
      // The new ticket's renewal is refused too, and so is the next ticket: the session is over.
      h.api.playbackTicket = async () => { throw Object.assign(new Error("signed out"), { status: 401 }); };
      intervals.at(-1)!();
      await flush(); await flush();
      expect(h.failures).toEqual(["wifi"]);
    } finally { restore(); h.pool.dispose(); await flush(); }
  });
});
