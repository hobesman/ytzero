# YT Zero TV

Native television client for Apple TV/tvOS, Android TV/Google TV, and Fire TV.
It uses Expo with `react-native-tvos`; Tizen and webOS are intentionally out of
scope.

On tvOS, the connection screen automatically discovers running instances through
Bonjour (`_ytzero._tcp.local.`). Choose a reachable server with the remote, then
pair with the existing QR/manual code. Manual address entry remains available.
The server advertises by default; set `YTZERO_DISCOVERY=0` to disable it.
See [local network discovery](../../docs/local-network-discovery.md) for Docker,
reverse proxies, protocol metadata and native build requirements.

The current vertical slice supports instance setup, QR/manual device pairing,
secure session storage, a profile-configured TV sidebar, a remote-focusable feed
with native tvOS thumbnail parallax, backend tag filters, channel and Shorts
views, a full remote-first Watch Page with profile actions, related videos and
instance-configured comments, and device settings for sign-out and instance
switching. The tvOS interface uses full-bleed artwork, a floating Liquid Glass
sidebar and shared remote focus animations with system accessibility fallbacks.
Native playback uses `expo-video`/AVPlayer, playback-scoped media tickets, native
scrubbing and track controls, resume progress, completion and incognito behavior.
At launch, the existing SVG logo separates into its blue tile and play mark.
The tile rotates forward from depth while a light streak gathers into the play
mark on the left. The mark winds back, then accelerates into the approaching tile
with a short motion trail. Contact triggers spring recoil, compression, a local
blue glow, an expanding ring and small particles. The mark settles inside as the
tile springs back into place, followed by a light sweep and a brief logo hold.
The native-driven sequence runs once
while the saved connection restores, holds the completed logo if needed, and
fades over the first screen. Reduce Motion shows the assembled logo with a short
fade. Returning from the background or manually changing YT Zero profiles does
not replay it. A system user change starts a new process through tvOS.
The small local `ytzero-player-control` module dispatches programmatic Apple
play/pause/seek to the main queue, avoiding an AVKit transport-bar Auto Layout
crash when closing playback on tvOS 26.5.
It also dismisses the native player before advancing the queue and provides
`TvFocusScope`, a UIKit focus environment for queue and text-reader modals.
This keeps focus on the moved or remaining queue item after editing the list.
Before presentation, the module supplies the title and channel through
`AVPlayerItem.externalMetadata`, which AVKit uses independently of Expo's optional
Now Playing notification manager. Rebuild the development client for this native change.
Playback failures emit `[YT Zero TV] playback` with the failing stage, HTTP status
when available, and native error domains/codes. Development builds also snapshot
the first playing frame and closing state, including buffering, stalls, dropped
frames and whether title metadata exists. These transient console diagnostics
exclude media URLs, tickets, headers, titles and raw error messages. Framework
console warnings alone do not establish a playback failure; compare them with
these snapshots and visible/audio symptoms. TextKit compatibility and MediaRemote
registration warnings are not suppressed or treated as fatal player errors.
`TvGradientMask` blends a blurred artwork copy into the lower background using
a UIKit-owned gradient mask, leaving the upper artwork sharp.

Followed playlists open as a catalogue first, then a video grid with Play All and
Continue Watching. Both clients read and save each followed playlist's sort on
the instance, scoped to the active profile. Playback retains that order across
the whole playlist, including entries beyond the initially visible cards. Back
returns to the selected catalogue row. Channel pages offer the same background
Sync action as the web client; the TV polls its status and refreshes the loaded
pages and live content when it finishes, retaining the current content while
requests are in flight. These changes are JavaScript-only; restart/update the
server for database migration 116 and the shared sort endpoint.

Home starts with a carousel of due scheduled videos and a thumbnail-only strip,
followed by Continue Watching, most-watched channels, tags and the remaining
feed. Focusing a thumbnail previews its video. The carousel rotates every eight
seconds and pauses on its controls and thumbnails, while covered by navigation
or a modal, offscreen, or with Reduce Motion enabled. Artwork crossfades after
the next image loads. Four-column video grids share the
same card typography and focus treatment. Details have one short description
that opens a full remote-scrollable reader. Setup, pairing and device settings
use the same glass controls as browsing.
The sidebar uses the instance's configured application name and logo color.
Video actions refresh the video's state before showing contextual operations.
Back buttons use a left arrow with a localized accessibility label.
Action lists reserve padding for the enlarged focus surface; their Back control
sits beside the heading. Focused controls keep an ordinary high-contrast surface
over the native material, so UIKit effect transitions cannot hide their labels.
Browse destinations have page headings except Home; live video cards show a red
localized badge in the lower-left corner.

Video metadata includes a small circular channel avatar, with an initial when
artwork is unavailable. Durations normalize total-minute values to `h:mm:ss`
when needed. Feed filters keep the displayed results until the replacement
request succeeds, ignore superseded requests, and gently transition the content
while preserving the focused filter's vertical position where scrolling permits.
Paginated feeds and channel grids use `TvGridList`: rows keep their first-item
key as a partial row fills, and each card retains its own key. Do not use
`FlatList numColumns` for appendable grids: its concatenated row keys remount
focused cards. Directional navigation uses native `nextFocus*` and focus guides;
global JS direction handlers must not move focus a second time. Entry and return
focus retries yield to subsequent remote navigation, including Select on key-up.
Horizontal lists use UIKit's native soft
[scroll edge effects](https://developer.apple.com/documentation/uikit/uiscrolledgeeffect)
on tvOS 26, replacing painted dark edge overlays. Earlier systems keep clear
edges. The new native scroll-edge view requires rebuilding the development client.

Selecting a video thumbnail starts playback by default. Device Settings can opt
into opening details first; this SecureStore preference stays on the television
and is excluded from server backups. Explicit Play and Details actions override
that preference. AVKit includes a Details action even without a queue. Back from
immediate playback restores the originating list and card; opening Details
intentionally keeps that screen as the player’s return destination.
The covered browse screen retains its layout and scroll position. Focus return
resolves the originating card's live ref after native dismissal, retries while
UIKit is transitioning, and stops if the user starts navigating.

On tvOS, swipe down for the next Short and up for the previous Short in the
current playback queue. Up/down remote buttons provide the same shortcuts.
These gestures apply only to adjacent Shorts while AVKit's transport bar is
hidden; with controls visible, vertical navigation stays with the system player.
Menu, Play/Pause and horizontal timeline seeking keep their normal behavior.
Shorts share one fullscreen controller and one React modal. Switching replaces
the player attached to the existing video view, without visiting Details.
The current Short and its two neighbours use memory-only native buffers with a
five-second forward-buffer target. Preloading never records history or progress
and disables disk caching. Neighbours stay paused and muted: only the attached
player can acquire audio ownership. Channel speed is applied at playback start
because setting expo-video's Apple playback rate can start a paused player.
Switching, closing and backgrounding mute all buffers before awaiting native
pause; a superseded native start cannot restore background audio.
Obsolete buffers and their scoped media tickets are
released as the queue moves and when playback closes. The previous frame stays
visible while an unprepared neighbour loads. Actual startup still depends on
YouTube extraction, network speed and the native decoder.
Rapid gestures are serialized until AVKit acknowledges the new player. Both
ends of that swap stay retained, and media tickets are revoked only after their
native sources are unloaded. A failed neighbour is retried once; if it still
fails, the current Short remains available and remote navigation is re-enabled.
The direct HLS server queues audio/video request bursts within its existing
four-buffer per-profile limit, with cancellation, a timeout and bounded waiting.
Progress is saved separately for each played Short, including rapid returns to
the same video. Only explicit Details or closing the player leaves fullscreen.
The native gesture recognizers require rebuilding the development client.
The implementation uses Apple's [remote gesture recognizers](https://developer.apple.com/library/archive/documentation/General/Conceptual/AppleTV_PG/DetectingButtonPressesandGestures.html)
and [transport-bar visibility delegate](https://developer.apple.com/documentation/avkit/avplayerviewcontrollerdelegate/playerviewcontroller(_:willtransitiontovisibilityoftransportbar:with:)).

The in-memory session queue supports adding, removing, reordering and clearing
up to 100 videos. It is available from the top bar, video details, long-press
actions and AVKit's native transport controls. An explicit queue plays in its
chosen order; otherwise the player resolves the next video with the web
client's source context, filters, sort order and continuation preferences. It
uses `/playback/adjacent`, including results beyond the currently loaded feed
page. Feed confirmation mode leaves the next-video action available in details.
Queue state clears on profile, instance, session or incognito changes and is
never stored in a backup. Apple transport-menu controls require rebuilding the
development client after updating the local player-control module.

Sources prioritize owned downloads and available TubeArchivist media. Videos
without a local copy use `/direct-hls/index.m3u8`: the server exposes YouTube's
H.264 video and AAC audio as native HLS, including byte-range seeking. This
works with downloads and experimental streaming disabled, and never starts an
offline download. The playback ticket covers both playlists, initialization
ranges and media fragments; the API bearer stays out of native player URLs.
See [direct streaming](../../docs/direct-streaming-research.md) for dependencies
and format limitations. Live/upcoming broadcasts
are not yet supported by this native player. Available embedded audio/subtitle
tracks use system controls; separate YouTube captions are not imported.
Tickets live in server memory, so clustered deployments need worker affinity
for ticket issuance, renewal and media requests.

```sh
bun install
bun test src
bun run typecheck
bunx expo prebuild --clean --no-install
bun run tvos
# or
bun run android
```

Expo Go does not support this TV fork, so use a generated development build.

### Android phone releases

The **Android APK** workflow (`.github/workflows/android-apk.yml`) builds the
arm64 release APK on every push to `main` that touches `apps/tv`, and publishes
it as a GitHub release tagged `android-<build>`. The build number is the APK's
`versionCode` (set through `app.config.ts`) and is inlined into the bundle as
`EXPO_PUBLIC_ANDROID_BUILD`. On an Android phone, **Settings → App updates**
compares it with the newest release and offers the APK download, and the avatar
menu shows **Update available** while a newer build waits. Builds made by hand
carry no number, so any release counts as newer. Releases are signed with the
stock Expo debug keystore, the same key as the hand-made builds, so they install
as updates; the workflow fails if the signing key ever changes. The check is
kept in memory only and stores nothing on the device.
See [`../../docs/tv-app-research.md`](../../docs/tv-app-research.md) for the
architecture and constraints, and [`../../docs/tvos-design-audit.md`](../../docs/tvos-design-audit.md)
for the design decisions and validation.

## Apple TV system profiles

In **Settings → Apple TV profiles**, enable **Follow the Apple TV user** to link
this system user to the current YT Zero profile. This device switch defaults off.
Each additional Apple TV user chooses a profile once; later launches restore the
saved choice before loading the feed. Manual profile switching does not overwrite
that link. Switch profiles and use **Link current profile** in settings to change
it. The section explains how to add users when tvOS reports a single-user device.

The native app adopts `runs-as-current-user-with-user-independent-keychain`.
tvOS relaunches it in the new user's context when someone changes users in Control
Center, including during playback. The existing background playback handler pauses
all buffers and writes progress; the new process starts with an empty session
queue. This uses the supported tvOS 16+ model, not deprecated current-user IDs or
manual system mapping panels. The app never reads Apple IDs or system user names.

A narrow Bun patch to Expo SecureStore adds `useUserIndependentKeychain` to its
native tvOS query. Only account-scoped pairing credentials are shared; sessions
bound to one profile remain in that system user's Keychain. The instance origin
and device preferences are shared. A legacy device-wide token is inherited only
if the server confirms account scope; otherwise the new user pairs individually.
Account sign-out revokes the shared TV session. Personal sign-out preserves other
users' personal sessions. A failed network request preserves pairing and offers
retry instead of opening the wrong profile.

The preference stores the existing profile UUID plus a local connection ID in
per-user UserDefaults. PINs, child locks, profile visibility and session permissions
still apply. Missing, removed or inaccessible profiles require a selection. The
server must expose `uuid` in `/api/profiles` to enable linking. Device preferences
and Keychain records never enter server backups; see the backup architecture.

After installing dependencies with `bun install` (which applies the tracked patch),
regenerate and rebuild the native app. A Metro refresh alone cannot add the
entitlement, native module or Keychain option. On a physical device, the App ID
and provisioning profile must include the **User Management / Runs as Current
User** capability. Android TV retains manual profile selection.

Apple references: [Mapping Apple TV users to app profiles](https://developer.apple.com/documentation/tvservices/mapping-apple-tv-users-to-app-profiles)
and [Support multiple users in tvOS apps](https://developer.apple.com/videos/play/wwdc2022/110384/).

Verification (2026-09-10): 93 TV tests; TV, backend and browser typechecks; focused
profile-route/PIN/child-lock tests, portable-backup exclusions, and all-language
catalogue tests passed. Expo prebuild, CocoaPods autolinking and the signed Debug
simulator build passed. On tvOS 26.5, pairing, cold-start session restoration and
remote navigation to the new settings section were verified. The simulator has
no configured system users and correctly disables linking with an explanation.
Actual Control Center switching, including during playback, still needs validation
on a physical Apple TV with two system users and the provisioned entitlement.
This is not yet a verified multi-user release build.

## Branding assets

The runtime mark and generated launcher, Android TV banner, tvOS icon, and Top
Shelf artwork all use the canonical source in `assets/brand/ytzero-logo.svg`.
After changing that source or the asset generator, rebuild the PNG set before
running Expo prebuild:

```sh
bun run assets
```

## tvOS, CocoaPods, and the simulator

`expo prebuild` generates the ignored `ios/` directory and installs the pods.
The normal flow does not require opening the Podfile or running CocoaPods by
hand:

```sh
cd apps/tv
bun install
bunx expo prebuild --clean
bunx expo run:ios --device "Apple TV 4K (3rd generation)"
```

If `pod --version` works and prebuild prints `Installed CocoaPods`, CocoaPods is
ready. When pod resolution itself fails, regenerate first. Run `pod install
--repo-update` from `apps/tv/ios` only when the error explicitly concerns the
local pod spec repository. Native directories stay generated and must not be
committed.

`No tvOS devices available in Simulator.app` is unrelated to CocoaPods. In
Xcode, install a tvOS runtime under **Xcode → Settings → Components**, then add
an Apple TV simulator under **Window → Devices and Simulators → Simulators**.
The available targets can be checked with:

```sh
xcrun simctl list devices available | rg "Apple TV"
```

On a physical Apple TV, the instance URL must be reachable from the television
over the LAN; `localhost` points at the television itself and will not reach the
development Mac.
