import { useEffect, useState } from "react";
import { ActivityIndicator, Share } from "react-native";
import { ApiError, type YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { shareMessage, youtubeVideoUrl } from "../shareLinks";
import type { Video } from "../types";
import { PhoneListRow } from "./PhoneList";
import { phoneColors } from "./phoneTheme";

/**
 * The video sheet's share rows: the youtube.com link, and, where the instance
 * lets this profile publish public links, a YT Zero link to watch it through
 * the user's own server. Both go to Android's share sheet.
 */
export function PhoneVideoShareRows({ api, video, t, onShared }: { api: YtZeroApi; video: Video; t: Translate; onShared: () => void }) {
  // undefined while asking; null when this profile can't publish a YT Zero link.
  const [publicShare, setPublicShare] = useState<{ url: string | null } | null | undefined>(undefined);
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
  const shareYtZero = async () => {
    if (busy || !publicShare) return;
    setBusy(true); setProblem(null);
    try {
      let url = publicShare.url;
      if (!url) {
        const created = await api.createVideoPublicShare(video.video_id);
        if (!created.active) { setProblem(t("shareExpired")); return; }
        url = created.url;
        setPublicShare({ url });
      }
      await share(url);
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 409 ? t("shareUnavailable") : t("shareFailed"));
    } finally { setBusy(false); }
  };
  return <>
    {youtube ? <PhoneListRow title={t("shareYouTubeLink")} onPress={() => void share(youtube)} /> : null}
    {publicShare ? <PhoneListRow title={t("shareYtZeroLink")} detail={problem ?? t("shareYtZeroLinkHint")}
      trailing={busy ? <ActivityIndicator color={phoneColors.textMuted} /> : undefined} onPress={() => void shareYtZero()} /> : null}
  </>;
}
