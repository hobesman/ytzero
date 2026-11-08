# YT Zero TV application rules

## Supported targets

- Target Apple TV/tvOS, Android TV/Google TV, and Fire TV through Expo and
  `react-native-tvos`.
- Do not add Tizen or webOS compatibility code to this app. Those platforms
  require separate web runtimes and packaging models and are intentionally out
  of scope.
- Keep generated `ios/` and `android/` projects out of version control. Native
  differences belong in Expo config plugins or small, documented native
  modules when a shared implementation is not sufficient.

## Ten-foot UI

- Every action must be reachable with a D-pad or Apple TV remote. Never require
  touch, hover, a pointer, or a long text-entry workflow.
- Use `Pressable` (or a component built on it), the platform focus engine, and a
  high-contrast focused state. Do not move focus unexpectedly after data loads.
- Keep primary content inside the safe area, use landscape layouts, large type,
  and controls that remain legible from a typical sofa distance.
- Map Back/Menu to the preceding screen and reserve Play/Pause for playback.
- Reuse `TvButton`, `VideoCard`, theme tokens, and screen patterns before adding
  a one-off primitive. User-facing strings belong in `src/i18n.ts` for every
  language supported by YT Zero.

## API, authentication, and persistence

- Normalize the instance origin with `normalizeInstanceUrl`; do not accept
  credentials or an arbitrary path in that URL.
- Pair through the device-code endpoints. The TV may display the complete QR
  URL and manual code, but it must never log or render its bearer access token.
  Phones may also sign in with a username and password through
  `/api/auth/device/password`, which shares the web login's check and attempt
  limits. The password is sent once and never stored or logged.
- Store the instance origin and access token only with `expo-secure-store`.
  Signing out revokes the server session and deletes the local token. Changing
  instances deletes both local values.
- Send the token in an `Authorization: Bearer` header. Never put a long-lived
  access token in an image, media, or query-string URL.
- The instance origin is machine-bound device configuration. Device pairing
  requests are transient and TV sessions are instance-local; none are portable
  backup data.

## Playback boundary

- Do not embed the YouTube IFrame player in a WebView. The TV app must use a
  native player backed by AVPlayer on tvOS and Media3/ExoPlayer on Android.
- Prefer `expo-video` once playback is introduced, but hide it behind a small
  YT Zero player interface. A platform-native module is acceptable if remote
  controls, DRM, captions, audio selection, or live/HLS behavior cannot be made
  reliable through the shared layer.
- Media authorization must use short-lived, playback-scoped tickets issued by
  the server. The player URL and every derived playlist/segment URL must remain
  valid without exposing the 30-day API bearer token.
- Preserve standard system playback behavior: Back closes controls or the
  player, Play/Pause toggles playback, and seeking uses the platform timeline.

## Verification

- Run `bun test src` and `bun run typecheck` from `apps/tv` for shared code.
- Run `bunx expo prebuild --no-install` when changing Expo/native configuration.
- Test focus traversal, Back/Menu, QR fallback code, token expiry, feed loading,
  and image/media access on at least one tvOS simulator and one Android TV
  emulator before calling a release build ready.
