# Alexa Skill

YT Zero can act as the backend for a private Alexa skill that plays music mode
on an Echo: "Alexa, ask Y T Zero to play Harvest Moon", "…play songs by
Radiohead", "…play the album OK Computer", "…play my liked songs" or "…play my
mix". A song, artist or album starts a station that keeps going after it, just
as on the phone. Pause, resume, next and start over work by voice and from the
device's buttons, and what you listen to is recorded in the profile's music
history, so stations learn from it.

The skill stays in development mode in your own Amazon developer account. It
works on every Echo signed in to that Amazon account, needs no certification,
and is never published. It plays as one YT Zero profile, chosen by the server.

## Requirements

- YT Zero reachable from the internet over **HTTPS on port 443** with a
  certificate from a public certificate authority (Let's Encrypt is fine). Amazon
  fetches both the skill requests and the audio from its own cloud, not from
  your Echo, so a LAN address or a self-signed certificate does not work.
- The `/alexa` path must reach YT Zero without any login in front of it. If
  your reverse proxy adds its own authentication (Authelia, Authentik forward
  auth, basic auth), exempt `/alexa` and everything under it. YT Zero checks
  every request there itself: skill requests must carry Amazon's signature, and
  audio links carry a signature made with your secret.
- The [YT-DLP Integration](YT-DLP-Integration) plugin, which music mode already
  needs for audio.

## 1. Create the skill

1. Sign in to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
   with the same Amazon account your Echo uses.
2. **Create Skill** → name it (for example *YT Zero*) → **Other** experience →
   **Custom** model → **Provision your own** hosting → start from scratch.
3. **Build → Interaction Model → JSON Editor**: paste the contents of
   [`docs/alexa-interaction-model.json`](https://github.com/hobesman/ytzero/blob/main/docs/alexa-interaction-model.json),
   then **Save** and **Build skill**. To use a different invocation name, change
   `invocationName` (lowercase; spell initialisms with periods and spaces, as
   in `y. t. zero`).
4. **Build → Interfaces**: turn on **Audio Player**, then **Build skill** again.
5. **Build → Endpoint**: choose **HTTPS**, enter
   `https://<your YT Zero address>/alexa` as the default region, and pick
   *My development endpoint has a certificate from a trusted certificate
   authority*. Save.
6. Copy the **Skill ID** (`amzn1.ask.skill.…`) shown at the top of the
   Endpoint page.

## 2. Configure YT Zero

Set these environment variables on the container and redeploy it:

| Variable | Value |
| --- | --- |
| `YTZERO_ALEXA_SKILL_ID` | The skill ID from step 6. Requests from any other skill are refused. |
| `YTZERO_ALEXA_PROFILE` | The profile the skill plays as: its name (case-insensitive) or its numeric ID. A child profile is refused. |
| `YTZERO_ALEXA_SECRET` | A random value of at least 32 characters, for example from `openssl rand -base64 48`. It signs the audio links handed to Alexa; changing it invalidates links already queued. |
| `APP_URL` | Your public `https://` address. Set `YTZERO_ALEXA_PUBLIC_URL` instead if Alexa should use a different one. |

The skill is off, and `/alexa` answers 404, until all of these are set.

## 3. Try it

In the developer console, **Test** → set *Skill testing is enabled in*
**Development**. Then on any Echo on your account: "Alexa, ask Y T Zero to play
my mix." The console's simulator can check the conversation, but it does not
play audio; use a real device for that.

## How it works

- `POST /alexa` receives the skill's requests. YT Zero checks Amazon's signing
  certificate (that it is Amazon's, valid and chains to a trusted root), the
  signature over the exact body, a timestamp no older than 150 seconds, and the
  skill ID, before doing anything.
- Each song is played from `GET /alexa/audio/<videoId>`, signed with
  `YTZERO_ALEXA_SECRET` for one song and one profile and valid for 24 hours, so
  a song paused overnight still resumes. The link grants nothing else.
- The station travels inside the stream token Alexa sends back with every
  event: its seed, the current song, and the last songs played and skipped.
  The server keeps no Alexa session, so a restart doesn't interrupt the queue.
- When a song nears its end, YT Zero picks the next one and starts fetching its
  audio, so it starts without a gap.

The configuration is machine-bound: none of it is stored in the database,
settings or backups.

## Limits

- **Previous**, shuffle and loop aren't supported: a station only goes forward.
- Responses are in English.
- The first song can take a few seconds to start while yt-dlp looks it up.
- For a skill only you use, the server's profile choice stands in for account
  linking. Anyone who talks to an Echo on your Amazon account plays as that
  profile.

## Troubleshooting

At startup the server log says `alexa.enabled` with the profile and endpoint,
or `alexa.disabled` with the reason when some `YTZERO_ALEXA_*` variable is set
but the configuration is incomplete. While running it records refused requests
as `alexa.request_refused` with a reason, failed songs as
`alexa.playback_failed`, and upstream errors as `alexa.request_failed`. No
`alexa` lines at all after a skill request means the request never reached YT
Zero's skill code: an image from before the skill, or a reverse proxy that
doesn't pass `/alexa` through.

- *"The requested skill's response was invalid"* or no response: check that
  `https://<address>/alexa` is reachable from outside your network, and that
  the four variables above are set (`/alexa` answers 404 when they're not).
- `reason: "untrusted certificate"` or `"certificate unavailable"`: the server
  could not download or verify Amazon's certificate. Check that the container
  has outbound HTTPS access to `s3.amazonaws.com`.
- `reason: "stale request"`: the server's clock is off by more than 150 seconds.
- Speech works but nothing plays: the audio link has to be reachable from
  Amazon's cloud. Check the proxy exemption for `/alexa/audio/`, and that
  music plays on the phone (yt-dlp is working).
