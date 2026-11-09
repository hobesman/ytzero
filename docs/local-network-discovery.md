# Local network discovery

YT Zero advertises its running HTTP server over Bonjour/mDNS. The tvOS
connection screen browses the LAN, verifies `/api/health`, and lists reachable
YT Zero instances. Selecting one starts the existing device-code pairing flow;
discovery never signs a television in automatically.

## Server configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `YTZERO_DISCOVERY` | `1` | Advertise on the LAN. `0`, `false`, `off` and `no` disable it. |
| `YTZERO_DISCOVERY_NAME` | Existing app name | Public display name. A stable suffix distinguishes machines/ports. Restart after changing it. |
| `YTZERO_DISCOVERY_PORT` | HTTP server port | Port reachable by clients, useful for a frontend proxy on the same machine. |
| `YTZERO_DISCOVERY_URL` | Resolved host and HTTP port | Optional HTTP(S) origin reached by clients, such as `https://video.example.com` or `http://192.168.1.20:8080`. No credentials, path, query or fragment. |

`bun run dev` sets `YTZERO_DISCOVERY_PORT=5174` so discovered televisions connect
through Vite and the QR pairing page opens on the UI origin. Restart an existing
development run after updating the script. When starting backend/UI separately,
set that port explicitly, or use `YTZERO_DISCOVERY_URL=http://192.168.1.20:5174`.
Use the Mac's LAN address;
`localhost` refers to the television on a physical Apple TV. `APP_URL` is not
automatically announced, because it may describe a different external endpoint.

Multicast socket errors disable discovery without preventing manual HTTP
connections. SIGINT/SIGTERM withdraw the announcement. The browser validates
service metadata, probes without credentials, and does not save scan results.

## Docker and network boundaries

mDNS requires multicast UDP 5353 on the local link. The television and server
must share a LAN that permits multicast; guest Wi-Fi isolation or VLAN boundaries
can prevent discovery even when a manually entered HTTP address works.

A Docker bridge normally keeps multicast inside the container network. Publishing
TCP port 3001 alone does not advertise onto the LAN. On a **Linux Docker host**,
set `network_mode: host` on the YT Zero service and remove its `ports` mapping;
the server then advertises on the host network and listens on `PORT` (3001 by
default). Existing data volumes do not change. A mapped/reverse-proxy URL alone
does not solve multicast isolation.

If host networking is unsuitable, advertise from the host's Bonjour/Avahi service
instead, using `_ytzero._tcp`, the reachable server port and TXT `version=1`,
`scheme=http` (or `scheme=https`). Optional TXT `url` must be a complete clean
origin. Disable the container's own announcer in that setup. Discovery across
VLANs requires an administrator-provided mDNS reflector; the app does not scan
subnets or change router configuration.

## Native implementation

The local Expo module in `apps/tv/modules/ytzero-discovery` uses Foundation's
`NetServiceBrowser` and `NetService` on the main run loop. It browses only
`_ytzero._tcp.local.`, resolves up to 32 services, removes departed services and
stops when the connection screen closes or the app backgrounds. A new scan
retries unavailable or unresolved instances without taking focus from the user.

`NSBonjourServices` and localized `NSLocalNetworkUsageDescription` are generated
from Expo configuration. All nine supported languages include interface and
native permission copy. The translations sit under `ios` in
`apps/tv/locales/*.json`, so Expo writes them only to the iOS/tvOS project:
Android has no such permission, and Android strings missing from the default
locale fail release lint. Rebuild the development client after pulling this
feature; a Metro refresh alone cannot add a Swift module:

```sh
cd apps/tv
bunx expo prebuild --no-install
bunx expo run:ios --device "Apple TV 4K (3rd generation)"
```

Android TV/Fire TV retain manual connection; native network discovery in this
change targets tvOS. No new profile setting or portable backup format is added.

## Protocol

The server publishes `_ytzero._tcp.local.` with SRV host/port and TXT
`version=1`, `scheme=http`, plus optional `url`. The UI strips the publisher's
stable hexadecimal suffix from the display name and shows the actual connection
origin underneath. Before displaying a choice, it requires a successful JSON
health response with `status: "ok"` and `app: "ytzero"`. Older installations
without discovery support remain reachable through manual setup.

The LAN is not an authentication boundary. An announcement contains no secrets,
and a discovered address gets no bearer token; authorization still requires
the user's existing pairing approval.

Implementation references: [Bonjour service](https://github.com/onlxltd/bonjour-service),
[Expo local modules](https://docs.expo.dev/modules/get-started/),
[Apple local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
