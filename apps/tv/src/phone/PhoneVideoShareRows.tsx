import { useEffect, useState } from "react";
import { ActivityIndicator, Share } from "react-native";
import { ApiError, type YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import type { PublicShare } from "../publicShareOptions";
import { shareMessage, youtubeVideoUrl } from "../shareLinks";
import type { Language, Video } from "../types";
import { PhoneListRow } from "./PhoneList";
import { PhoneShareLinkSheet } from "./PhoneShareLinkSheet";
import { phoneColors } from "./phoneTheme";

/**
 * The video sheet's share rows: the youtube.com link, and, where the instance
 * lets this profile publish public links, a YT Zero link to watch it through
 * the user's own server, whose streaming and limits are set before sharing.
 * Both go to Android's share sheet.
 */
export function PhoneVideoShareRows({ api, video, t, language, onShared }: {
  api: YtZeroApi; video: Video; t: Translate; language: Language; onShared: () => void;
}) {
  // undefined while asking; null when this profile can't publish a YT Zero link.
  const [publicShare, setPublicShare] = useState<{ share: PublicShare | null } | null | undefined>(undefined);
  const [editing, setEditing] = useState<PublicShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.videoPublicShare(video.video_id).then((found) => { if (active) setPublicShare(found); }, () => { if (active) setPublicShare(null); });
    return () => { active = false; };
  }, [api, video.video_id]);

  const youtube = youtubeVideoUrl(video.video_id);
  const share = async (url: string) => {
    await Share.share({ message: shareMessage(video.title, url) }).catch(() => {});
    onShared();
  };
  const openYtZero = async () => {
    if (busy || !publicShare) return;
    if (publicShare.share) { setEditing(publicShare.share); return; }
    setBusy(true); setProblem(null);
    try {
      const created = await api.createVideoPublicShare(video.video_id);
      setPublicShare({ share: created });
      setEditing(created);
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 409 ? t("shareUnavailable") : t("shareFailed"));
    } finally { setBusy(false); }
  };
  const close = () => setEditing(null);
  return <>
    {youtube ? <PhoneListRow title={t("shareYouTubeLink")} onPress={() => void share(youtube)} /> : null}
    {publicShare ? <PhoneListRow title={t("shareYtZeroLink")} detail={problem ?? t("shareYtZeroLinkHint")}
      trailing={busy ? <ActivityIndicator color={phoneColors.textMuted} /> : undefined} onPress={() => void openYtZero()} /> : null}
    {editing ? <PhoneShareLinkSheet api={api} share={editing} title={video.title} t={t} language={language}
      onChange={(latest) => setPublicShare({ share: latest })}
      onShare={(url) => { close(); void share(url); }} onClose={() => close()} /> : null}
  </>;
}
