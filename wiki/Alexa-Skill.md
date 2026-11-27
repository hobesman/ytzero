# Alexa Skills

YT Zero can be the backend for two private Alexa skills. Set up either or both.

**Hoban Music** plays music mode: "Alexa, ask Hoban Music to play Harvest
Moon", "…play songs by Radiohead", "…play the album OK Computer", "…play my
liked songs", "…play my mix" or, with a queue saved for the room, "…play my
queue". A song or album starts a station that keeps
going after it, just as on the phone. "…play songs by Radiohead" plays only
Radiohead, shuffled, until their songs run out, then a station like them; for a
mix of similar artists from the start, say "…play Radiohead radio". A genre,
mood or decade starts a station too:
"…play 80s music", "…play some jazz", "…play the latest pop music" or "…play
music for working out". Listens are recorded in the profile's music history,
so stations learn from them.

**Hoban Tube** plays the audio of ordinary videos: "Alexa, ask Hoban Tube to
play how to fix a leaky faucet from This Old House", or "…play the latest from
Mark Rober". A video plays once and stops. To keep going, shuffle a channel:
"…play videos from Mark Rober" or "…shuffle Mark Rober" plays its videos in a
random order, one after another. "…play a random video from Mark Rober" plays
just one. Listening counts as watching: it resumes where you left off on
another device, shows in Continue watching, and is marked watched at the end.

To hear what's playing, say "Alexa, ask Hoban Music what's playing". The skill
answers from the song it sent, so it stays right even when Alexa's own "what
song is this?" goes stale, which can happen after a song fails to resume.

Both skills support pause, resume and start over, by voice and with the
device's buttons. The music skill and a shuffled channel also support next. In
the video skill, say "skip forward 2 minutes" or "go back 30 seconds".

These names are only examples: the skills answer to whatever invocation names
you give them in step 1.

Both skills stay in development mode in your own Amazon developer account. They
work on every Echo registered to that Amazon account, need no certification,
and are never published. They play as one YT Zero profile, chosen by the
server.

## Requirements

- YT Zero reachable from the internet over **HTTPS on port 443** with a
  certificate from a public certificate authority (Let's Encrypt is fine).
  Amazon's cloud sends the skill requests, so a LAN address or a self-signed
  certificate does not work. The Echo itself fetches the audio, so the same
  address must also work from inside your network. If it resolves to your
  public IP, your router has to loop that traffic back in (NAT loopback, or
  hairpinning), or local DNS must point the name at the server.
- The `/alexa` path must reach YT Zero without any login in front of it. If
  your reverse proxy adds its own authentication (Authelia, Authentik forward
  auth, basic auth), exempt `/alexa` and everything under it. YT Zero checks
  every request there itself: skill requests must carry Amazon's signature, and
  audio links carry a signature made with your secret.
- The [YT-DLP Integration](YT-DLP-Integration) plugin, which provides the audio.

## 1. Create the skills

Repeat these steps once per skill, using that skill's interaction model:

| Skill | Interaction model | Invocation |
| --- | --- | --- |
| Music | [`docs/alexa-music-interaction-model.json`](https://github.com/hobesman/ytzero/blob/main/docs/alexa-music-interaction-model.json) | `hoban music` |
| Video | [`docs/alexa-video-interaction-model.json`](https://github.com/hobesman/ytzero/blob/main/docs/alexa-video-interaction-model.json) | `hoban tube` |

1. Sign in to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
   with the same Amazon account your Echo uses.
2. **Create Skill** → name it (for example *Hoban Music*) → **Other**
   experience → **Custom** model → **Provision your own** hosting → start from
   scratch. Choose the language your Echos use. Each language needs its own
   copy of the model; add more from the language list at the top of **Build**.
3. **Build → Interaction Model → JSON Editor**: paste the contents of the
   skill's interaction model, then **Save** and **Build skill**. To use a
   different invocation name, change `invocationName`. It must be lowercase and
   at least two words. Ordinary words work best: spelled-out letters such as
   `y. t. video` are easily misheard as another skill's name. When you paste a
   newer model later, change `invocationName` back to yours before building.
   The skill's display name (**Distribution → Public Name**) is what Alexa
   announces when the skill opens, so keep it close to the invocation.
4. **Build → Interfaces**: turn on **Audio Player**, then **Build skill** again.
5. **Build → Endpoint**: choose **HTTPS**, enter
   `https://<your YT Zero address>/alexa` as the default region, and pick
   *My development endpoint has a certificate from a trusted certificate
   authority*. Save. Both skills use the same endpoint.
6. Copy the **Skill ID** (`amzn1.ask.skill.…`). It's under **Copy Skill ID**
   beneath the skill's name in the console's skill list, and it's also in the
   browser's address bar while you edit the skill.
7. **Test** → set *Skill testing is enabled in* to **Development**.

## 2. Configure YT Zero

Set these environment variables on the container and redeploy it:

| Variable | Value |
| --- | --- |
| `YTZERO_ALEXA_SKILL_ID` | The music skill's ID. Leave it out to run only the video skill. |
| `YTZERO_ALEXA_VIDEO_SKILL_ID` | The video skill's ID. Leave it out to run only the music skill. Requests from any skill other than these two are refused. |
| `YTZERO_ALEXA_PROFILE` | The profile the skills play as: its name (case-insensitive) or its numeric ID. Its likes, mix, followed channels and history are the ones used. A child profile is refused. |
| `YTZERO_ALEXA_SECRET` | A random value of at least 32 characters, for example from `openssl rand -base64 48`. It signs the audio links handed to Alexa; changing it invalidates links already queued. |
| `APP_URL` | Your public `https://` address, such as `https://yt.example.com`. Set `YTZERO_ALEXA_PUBLIC_URL` instead if Alexa should use a different one. |

Don't put quote marks around a value in a list-form compose entry
(`- APP_URL=https://…`), in Portainer's environment panel or in an `.env` file:
there they become part of the value. Only the `KEY: "value"` form strips them.

The skills are off, and `/alexa` answers 404, until a skill ID, the profile,
the secret and an `https://` address are all set.

### Updating a skill

When a new version adds commands (genres, shuffling a channel), paste the
updated interaction model into the skill's JSON Editor, set `invocationName` to
your skill's, then **Save** and **Build skill**. The skill ID and the
environment variables stay the same.

## 3. Try it

On any Echo on your account: "Alexa, ask Hoban Music to play my mix", or
"Alexa, ask Hoban Tube to play the latest from" one of your channels. The
console's simulator can check the conversation, but it does not play audio;
use a real device for that.

## Finding a video

"Play *title* from *channel*" is heard as one phrase, then split at the last
"from":

1. The part after it is matched against the channels the profile follows. The
   match is forgiving, because speech recognition often mangles names: "marc
   robber" finds *Mark Rober*.
2. The part before it is matched against that channel's videos in YT Zero. You
   can say part of a title, and the newest video wins a tie.
3. If the title isn't among them, YouTube is searched for the title and channel,
   keeping only results from that channel.
4. If the end of the phrase doesn't match a followed channel, the whole phrase
   is searched on YouTube and the top result plays. That works, but it is less
   predictable.

So the video skill works best with channels the profile follows. If the skill
plays as a profile of its own, have that profile follow your channels, or set
`YTZERO_ALEXA_PROFILE` to your main profile.

"Play the latest from *channel*" plays the channel's newest video, skipping
Shorts and live streams.

"Play videos from *channel*" and "shuffle *channel*" pick from the channel's
videos in YT Zero at random, never a Short or a live stream, and queue the
next one as each ends. Videos the profile hasn't watched come first, and none
repeats until all of them have played. "Play a random video from *channel*"
picks the same way but plays only one. All three need a channel the profile
follows.

## Following channels

The video skill can follow and unfollow channels for its profile, and it
always asks first:

- "Alexa, ask Hoban Tube to find the channel This Old House" (or "…follow This
  Old House") searches YouTube and offers the matches one at a time, with their
  subscriber counts: "The first match is This Old House, with 2.1 million
  subscribers. Follow it?" Say **yes** to follow it, or **no** to hear the next
  one, up to ten. A match the profile already follows is named as such, and
  yes moves on past it.
- While a video plays (or is paused), "…follow this channel" offers to follow
  that video's channel.
- "…unfollow This Old House" offers the followed channels that match, and
  "…unfollow this channel" the playing video's channel. Unfollowing keeps the
  profile's settings for the channel, as the app's Unfollow button does.

Nothing changes without a yes. If you don't answer, Alexa asks once more; if
there's still no answer, nothing is changed.

## Finding a genre

"Play *genre* music" goes through YouTube Music's **Moods & genres**, the same
list music mode shows on the phone:

1. A decade ("80s", "the eighties", "nineteen seventies rock") plays that
   decade's shelf in the *Decades* category: *The Hits: '80s*, or the playlist
   whose name fits best, such as *'80s Rock*.
2. A genre or mood ("jazz", "hip hop", "chill", "workout") plays its
   category's first playlist, or the one that fits the rest of the phrase:
   "classic rock" opens *Rock* and picks its classic rock playlist.
3. "Latest", "new" or "fresh" prefers a playlist named for new music, such as
   *Pop Hotlist*.
4. Anything else is searched among YouTube Music's own playlists.

The playlist's songs play shuffled. Once they run low, the station carries on
like any other, following the songs you kept listening to.

## Rooms and now playing

YT Zero remembers each Echo the skills hear from and what it is playing, so a
screen in a room (a wall tablet, say) can show that room's Echo. Amazon gives
each skill a different ID for the same Echo, so an Echo is paired once per
skill, with the same room name for both.

- **By voice**: "Alexa, ask Hoban Music, this is the kitchen", then the same
  for Hoban Tube. "Alexa, ask Hoban Music which room is this?" says the room.
- **Paired by an automation** (Home Assistant, for one): call
  `POST /api/alexa/pairing` with `{"room": "Kitchen"}`, then, within two
  minutes, have that one Echo hear "ask Hoban Music to pair" and "ask Hoban
  Tube to pair". Each skill takes the waiting room once.

The API needs a signed-in session as the profile in `YTZERO_ALEXA_PROFILE`,
since the records belong to the profile the skills play as:

| Request | Does |
| --- | --- |
| `GET /api/alexa/rooms` | Each room, what it's playing (`nowPlaying`), its devices, Echos not yet paired, and any pairing waiting. |
| `GET /api/alexa/devices` | Every device, with its room and what it's playing. |
| `PATCH /api/alexa/devices` | `{"skill", "deviceId", "room"}` names a device's room; `"room": null` unpairs it. |
| `DELETE /api/alexa/devices` | `{"skill", "deviceId"}` forgets a device. |
| `POST /api/alexa/rooms/rename` | `{"from", "to"}` renames a room on all its devices. |
| `POST` / `DELETE /api/alexa/pairing` | Sets or cancels the room waiting for "pair". |

`nowPlaying` has the video ID, title, artist (or channel), art, `durationMs`,
`state` (`playing`, `paused`, `stopped`, `finished` or `failed`), and the
position: `offsetMs` is what Alexa last reported, which it does only when
something happens, and while playing `startedAt` is when position 0 was, so a
client draws live progress as now minus `startedAt`. `positionMs` is that,
worked out when the response was sent, beside `serverTime`.

A song or video becomes `nowPlaying` only once an Echo reports that it
started. Until then a room shows it as `pending` (the same details, plus
`requestedAt`), for up to two minutes. Alexa sometimes plays a request on a
different Echo from the one asked; the song then shows in the room whose Echo
plays it, and the room that asked keeps what it had.

All times are UTC (ISO 8601, ending in `Z`), for a client to show in local
time.

The skills see only themselves: Amazon Music or another skill on the same
Echo shows up here only through Home Assistant (below). A skill's audio plays only on the Echo it was asked
on, not on a speaker group.

## Home Assistant: room controls, one-tap pairing and queues

With Home Assistant's [Alexa Media Player](https://github.com/alandtse/alexa_media_player)
integration, YT Zero can control each room's Echo and see what Amazon's own
sources (Amazon Music, say) play there. Home Assistant types commands to an
Echo as if spoken ("ask hoban music to pair"), so a tablet button can pair an
Echo, pause it, skip a song or start a queue.

Set these on the container too:

| Variable | Value |
| --- | --- |
| `YTZERO_HOME_ASSISTANT_URL` | Home Assistant's address as the server reaches it, such as `http://192.168.0.10:8123`. |
| `YTZERO_HOME_ASSISTANT_TOKEN` | A long-lived access token: in Home Assistant, your profile → **Security** → **Long-lived access tokens** → **Create token**. It's a secret: YT Zero never logs it or returns it. |
| `YTZERO_ALEXA_MUSIC_INVOCATION` | The music skill's invocation name, such as `hoban music`. Typed commands have to say it. |
| `YTZERO_ALEXA_VIDEO_INVOCATION` | The video skill's, such as `hoban tube`. |

The bridge is off, and its requests answer 503, until the address and token
are both set. Then give each room its Echo's Home Assistant entity:
`GET /api/alexa/home-assistant` lists Home Assistant's Alexa media players,
and `PUT /api/alexa/rooms/Kitchen/entity` with
`{"entity": "media_player.kitchen_echo"}` maps the room to one (`null` clears
it). A room with an entity is listed in `GET /api/alexa/rooms` even before any
Echo is paired with it.

| Request | Does |
| --- | --- |
| `GET /api/alexa/home-assistant` | Whether the bridge is on, the invocation names, and Home Assistant's Alexa media players (`?all=1` for every media player). |
| `PUT /api/alexa/rooms/<room>/entity` | `{"entity"}` sets or clears the room's Echo entity. Home Assistant must know the entity. |
| `POST /api/alexa/rooms/<room>/pair` | Pairs the room's Echo with both skills in one call. |
| `POST /api/alexa/rooms/<room>/control` | `{"action": "pause"}`, `"resume"`, `"next"`, or `"volume"` with `"volume"` from 0 to 10. |
| `GET` / `PUT` / `DELETE /api/alexa/rooms/<room>/queue` | Reads, saves or clears the room's queue. |
| `POST /api/alexa/rooms/<room>/queue/play` | Starts the saved queue on the room's Echo. |

**One-tap pairing** sets the room waiting, as `POST /api/alexa/pairing` does,
then types "ask hoban music to pair" to the room's Echo and waits up to 30
seconds for the music skill to claim it, then does the same for Hoban Tube. It
answers with `paired` (the skills that paired) and `failed` (each with a
reason), so it takes up to a minute. The Echo answers aloud, "Paired. This is
the Kitchen."

**Controls** go the way the Echo can hear them. Home Assistant can't see a
skill's audio (it shows the Echo as idle), so while Hoban Music or Hoban Tube
plays in the room, or when Home Assistant sees nothing playing, the Echo gets a
typed command: "pause", "next", or "ask hoban music to resume" (Hoban Tube's
name if that skill played last). When Home Assistant sees something playing,
such as Amazon Music, it's paused, resumed and skipped with Home Assistant's
own media player services. Resume picks whichever paused last. Volume always
sets the Echo's own volume through Home Assistant, which works whatever is
playing; if that fails, the Echo is told "volume 5". The answer says how it was
sent: `via` is `typed` (with the `command`) or `home-assistant` (with the
`service`).

**Play my queue** (Hoban Music only) plays what a tablet queued for the room:

```json
PUT /api/alexa/rooms/Kitchen/queue
{ "videoIds": ["…", "…"], "title": "Dinner", "play": true }
```

Give either `videoIds` (up to 500 songs, each already in the music catalog,
as anything the app's music pages show is) or a station `seed`: an album
(`{"kind": "album", "browseId": "MPREb_…"}`), a playlist
(`{"kind": "playlist", "playlistId": "…"}`), an artist
(`{"kind": "artist", "artistId": "UC…", "radio": true}` for their radio),
`{"kind": "liked"}` or `{"kind": "mix"}`. `"play": true` starts it at once by
telling the room's Echo "ask hoban music to play my queue"; anyone can also
just say "Alexa, ask Hoban Music to play my queue" to an Echo paired with the
room. A list of songs plays in order, then carries on as a station like its
last song, the way an album does. Saving a new queue replaces the room's last
one; an Echo still playing the old one carries on into the station.

`GET /api/alexa/rooms` then also has, for each room with an entity,
`homeAssistant`: what Home Assistant reports (`state`, `title`, `artist`,
`album`, `art`, `durationMs`, `positionMs`, `source` — the Echo's input, such as
Local Speaker — `volume` from 0 to 1, and `error` if Home Assistant couldn't be
asked), and `current`: what the room's screen should show. That is the skills'
record while one of them plays, else what Home Assistant sees, else the skills'
last record. Its `origin` is `music`, `video` or `home-assistant`.

Home Assistant doesn't say which service is playing, only what. Its art is
shown only when it's a public link.

### Paste into the Alexa console

"Play my queue" needs the music skill's newer interaction model. In the
developer console, open the music skill → **Build → Interaction Model → JSON
Editor**, paste the whole of
[`docs/alexa-music-interaction-model.json`](https://github.com/hobesman/ytzero/blob/main/docs/alexa-music-interaction-model.json),
change `invocationName` back to yours, then **Save** and **Build skill**. Or,
to add just the new intent: **Intents → Add Intent → Create custom intent**,
name it `PlayQueueIntent`, and add these sample utterances:

```text
play my queue
play the queue
play my queued songs
play what's queued
play what I queued
play the queue for this room
start my queue
start the queue
```

then **Save** and **Build skill**.

## How it works

- `POST /alexa` receives both skills' requests. YT Zero checks Amazon's signing
  certificate (that it is Amazon's, valid and chains to a trusted root), the
  signature over the exact body, a timestamp no older than 150 seconds, and the
  skill ID, before doing anything. The skill ID decides whether the music or
  the video skill answers.
- A song plays from `GET /alexa/audio/<videoId>`, and a video from
  `GET /alexa/video-audio/<videoId>`. Each link is signed with
  `YTZERO_ALEXA_SECRET` for one item, one profile and one kind, and is valid for
  24 hours, so a song or video paused overnight still resumes. A link grants
  nothing else: a song link can't open a video, and the reverse. A request
  with no byte range gets the whole file (200), which the Echo needs to play
  past the proxy's first 8 MB piece; ranged requests are answered as for the
  app's player. Every audio request is logged as `alexa.audio`, with its range.
- Every Hoban Tube video plays as an HLS playlist,
  `GET /alexa/video-audio/<videoId>/index.m3u8`, signed like the file: the
  app's own audio playlist (segments of about 20 seconds), each segment a byte
  range of the signed file. An Echo plays any stream from its own start,
  whatever offset it is given, and reports that offset plus the time played
  as its position. So to start part way in (a resume, a skip), the link's `t`
  starts the playlist at the segment holding that place, and the offset sent
  is where that segment starts: a resume can go back up to 20 seconds. Audio
  that can't be indexed is served whole, from its start (logged as
  `alexa.playlist_unavailable`).
- Each station travels inside the stream token Alexa sends back with every
  event: its seed, the current song, and the last songs played and skipped.
  The server keeps no Alexa session, so a restart doesn't interrupt the queue.
- When a song nears its end, YT Zero picks the next one and starts fetching its
  audio, so it starts without a gap.
- A video's progress is saved when it stops or pauses, and every 30 seconds
  while it plays (Alexa reports nothing in between, so this is the time since
  it started), so Continue watching keeps up. It's marked watched when it plays
  to the end, as in the app's player. A stream that ends more than a minute
  before the video does keeps its place instead.
- "Alexa, ask Hoban Tube to resume" continues the video the Echo last played.
  If the Echo has since played something else, it picks up the last video that
  Echo played, or else the profile's most recent unfinished one, where it
  stopped. Either way it goes on from the profile's latest saved place, not the
  Echo's own, since the video may have played further on another Echo or in
  the app since.

The configuration is machine-bound: none of it is stored in the database,
settings or backups. Each room's Home Assistant entity and queue are kept in
the database with the devices, and left out of portable backups too. The Echo devices, their rooms and what each is playing are
kept in the database, shared by every replica, and left out of portable
backups.

## Limits

- **Previous**, loop and Alexa's own shuffle command aren't supported. A
  station or a shuffled channel only goes forward, and a single video doesn't
  queue another after it.
- Skip forward and back need the skill's name: "Alexa, ask Hoban Tube to skip
  forward 2 minutes". Only Alexa's built-in commands (pause, resume, next,
  start over) work without it.
- Responses are in English.
- The first song or video can take a few seconds to start while yt-dlp looks
  it up.
- Live streams, premieres that haven't started, members-only and private videos
  can't be played.
- For skills only you use, the server's profile choice stands in for account
  linking. Anyone who talks to an Echo on your Amazon account plays as that
  profile.

## Troubleshooting

At startup the server log says `alexa.enabled` with the profile, the endpoint
and which skills are on. If any `YTZERO_ALEXA_*` variable is set but the
configuration is incomplete, it says `alexa.disabled` with the reason instead.
While running, it logs:

- `alexa.request` for every request a skill answers: which skill, the request
  type, the intent and what was said (`query`), and what the skill did. That
  includes what it replied (`said`), and whether it played or queued a song or
  video (`action`, `videoId`, `title`) or stopped. AudioPlayer events also
  carry the playback position and any device error.
- `alexa.audio` when the Echo starts fetching a song's or video's audio, with
  the status and how long YT Zero took to answer (`ms`). It logs only the first
  request of each stream, not every later chunk.
- `alexa.audio_failed` when an audio request is refused or fails, with the
  status and a reason, such as `yt-dlp unavailable` or
  `audio unavailable from YouTube`.
- `alexa.channel_followed` and `alexa.channel_unfollowed` when a yes follows or
  unfollows a channel.
- `alexa.request_refused` (with a reason), `alexa.profile_missing`,
  `alexa.playback_failed` and `alexa.request_failed` for the other problems.

Run `docker exec ytzero grep alexa /data/logs/ytzero.log | tail -30` right
after trying something. What's missing tells you as much as what's there:

- **No `alexa.request` line:** Alexa never sent the request to YT Zero. It
  answered by itself (a reply that isn't one of the skill's own, such as
  "I couldn't find that video on YouTube"), the skills are switched off, or the
  proxy is in the way.
- **`alexa.request` with `action: "play"` but no `alexa.audio`:** the Echo
  never reached the audio link. Usually that's DNS or NAT loopback inside your
  network; see Requirements.
- **`alexa.audio` with a large `ms`:** the first byte took too long, and the
  Echo may give up with `MEDIA_ERROR_SERVICE_UNAVAILABLE`.

- *"There was a problem with the requested skill's response"*: send
  `curl -si -X POST https://<address>/alexa -d "{}"` from outside your
  network. A working endpoint answers `400` with `{"error":"invalid signature"}`,
  because curl's request isn't signed by Amazon. `404` with
  `{"error":"not found"}` means the skills are switched off: the startup log
  says why. An HTML page means an image from before the skills; a login page
  means the proxy is in the way.
- `reason: "wrong skill"`: the request came from a skill whose ID matches
  neither `YTZERO_ALEXA_SKILL_ID` nor `YTZERO_ALEXA_VIDEO_SKILL_ID`.
- `reason: "untrusted certificate"` or `"certificate unavailable"`: the server
  could not download or verify Amazon's certificate. Check that the container
  has outbound HTTPS access to `s3.amazonaws.com`.
- `reason: "stale request"`: the server's clock is off by more than 150 seconds.
- Speech works but nothing plays: the Echo has to reach the audio link from
  inside your network. Check the proxy exemption for `/alexa/`, NAT loopback or
  local DNS, and that audio-only playback works in the app (yt-dlp is working).
- A skill isn't found on one Echo: that Echo's language has no model in the
  skill, or it's registered to a different Amazon account.
- *"<name> is not supported on this device"*, or a reply that isn't one of the
  skill's own, such as "I couldn't find that video on YouTube": the skill
  itself won't start, and Alexa falls back to its own features. Check that
  testing is set to **Development** for that skill, that the skill has a model
  for the device's language, that it's a **Custom** skill with **Provision your
  own** hosting, and that **Build → Interfaces** has only **Audio Player** on.
  If all of that looks right and it still won't start, create the skill again
  from step 1. Its new Skill ID then goes in the environment variable. Saying
  "open <name>" in the console's simulator is a quick check: the skill should
  answer with its own greeting.
