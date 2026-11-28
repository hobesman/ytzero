import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { musicApi } from "../music/musicApi";
import type { RoomCurrent } from "./roomApi";
import { roomPath } from "./roomState";

/** Where tapping now playing's cover leads: a book's page, or a song's album (looked up first). */
export function openPlayingTarget(current: RoomCurrent | null): { kind: "book"; id: string } | { kind: "song"; videoId: string } | null {
  if (!current) return null;
  if (current.origin === "books" && current.book?.bookId) return { kind: "book", id: current.book.bookId };
  if (current.origin === "music" && current.videoId) return { kind: "song", videoId: current.videoId };
  return null;
}

/**
 * The cover's action for the room page, and a note when a song's album can't
 * be found. Opening shows the page in the browse panel below, out of lyrics.
 */
export function useOpenPlaying(homeRoom: string | null, current: RoomCurrent | null, beforeOpen: () => void) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const target = openPlayingTarget(current);
  const key = target ? (target.kind === "book" ? target.id : target.videoId) : "";
  useEffect(() => setNotice(null), [key]);
  if (!homeRoom || !target) return { action: undefined, notice };
  const title = current?.title ?? "";
  const go = (path: string) => { beforeOpen(); navigate(roomPath(homeRoom, path)); };
  const action = target.kind === "book"
    ? { label: t("roomOpenBook", { title }), open: () => go(`books/book/${encodeURIComponent(target.id)}`) }
    : {
      label: t("roomOpenAlbum", { title }),
      open: () => {
        setNotice(null);
        musicApi.trackAlbum(target.videoId).then(
          (browseId) => browseId ? go(`music/album/${encodeURIComponent(browseId)}`) : setNotice(t("roomAlbumNotFound")),
          () => setNotice(t("roomAlbumNotFound")),
        );
      },
    };
  return { action, notice };
}
