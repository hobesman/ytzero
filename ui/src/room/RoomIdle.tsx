import { useI18n } from "../i18n";
import { parseAppTimestamp } from "../dateTime";
import type { RoomCurrent } from "./roomApi";
import { deviceTimeZone } from "./roomState";
import { useNow } from "./useRoomState";

/**
 * The dim screen shown when nothing plays: a clock in the tablet's own time
 * zone and what played last. It drifts a few pixels each minute so nothing
 * stays lit in one place all day. A touch anywhere wakes the page.
 */
export function RoomIdle({ roomName, last, lastAt }: { roomName: string; last: RoomCurrent | null; lastAt: string | null }) {
  const { t, locale } = useI18n();
  const now = useNow(15_000);
  const timeZone = deviceTimeZone();
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(now);
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone }).format(now);
  const minute = Math.floor(now / 60_000);
  const drift = { transform: `translate(${(minute % 7) * 6 - 18}px, ${(minute % 5) * 6 - 12}px)` };
  const at = lastAt ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(parseAppTimestamp(lastAt)) : null;
  return <div className="room-idle" role="button" tabIndex={0} aria-label={t("roomWake")}>
    <div className="room-idle__content" style={drift}>
      <div className="room-idle__room">{roomName}</div>
      <div className="room-idle__clock">{clock}</div>
      <div className="room-idle__date">{date}</div>
      {last?.title ? <div className="room-idle__last">
        <span className="room-idle__last-label">{at ? t("roomLastPlayedAt", { time: at }) : t("roomLastPlayed")}</span>
        <span className="room-idle__last-title">{[last.title, last.artist].filter(Boolean).join(" · ")}</span>
      </div> : null}
    </div>
  </div>;
}
