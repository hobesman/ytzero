import { Alert } from "react-native";
import type { Translate } from "../i18n";
import { localeTags } from "../i18n";
import { downloadFraction, formatBytes, viewDownload, type PhoneDownload } from "../phoneDownloads";
import type { Language, Video } from "../types";
import { phoneDownloads, usePhoneDownloads } from "../usePhoneDownloads";
import { PhoneChip } from "./PhoneChip";
import { PhoneListRow } from "./PhoneList";

const failureKeys = {
  disabled: "downloadFailedDisabled", notAllowed: "downloadFailedNotAllowed", server: "downloadFailedServer", transfer: "downloadFailedTransfer",
} as const;

/** One line on where a download stands: progress, waiting, size, or why it failed. */
export function downloadStatusLabel(item: PhoneDownload, t: Translate, language: Language): string {
  const locale = localeTags[language];
  const fraction = downloadFraction(item);
  const percent = fraction === null ? "" : String(Math.round(fraction * 100));
  if (item.state === "failed") return t(failureKeys[item.error ?? "transfer"]);
  if (item.state === "done") return [t("downloadedOnPhone"), item.size ? formatBytes(item.size, locale) : ""].filter(Boolean).join(" · ");
  if (item.state === "server") return percent ? t("downloadPreparingPercent").replace("{percent}", percent) : t("downloadPreparing");
  if (item.waiting === "wifi") return t("downloadWaitingWifi");
  if (item.waiting === "network") return t("downloadWaitingNetwork");
  return percent ? t("downloadProgress").replace("{percent}", percent) : t("downloadStarting");
}

/** Asks before deleting a downloaded video from the phone. */
export function confirmDeleteDownload(video: Video, t: Translate, onDeleted?: () => void) {
  Alert.alert(t("deleteFromPhone"), t("deleteDownloadConfirm").replace("{title}", video.title), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deleteDownload"), style: "destructive", onPress: () => { void phoneDownloads.remove(video.video_id).then(onDeleted); } },
  ]);
}

/**
 * What the phone can do with a video's download: start it, retry it, or cancel
 * or delete it. Null when the video can't be saved here.
 */
function useDownloadAction(video: Video, t: Translate, language: Language, canStart: boolean) {
  const view = usePhoneDownloads();
  const store = phoneDownloads;
  if (!view.available) return null;
  const item = viewDownload(view, video.video_id);
  if (!item) return canStart ? { label: t("downloadToPhone"), detail: undefined, danger: false, onPress: () => void store.download(video) } : null;
  const detail = downloadStatusLabel(item, t, language);
  if (item.state === "failed") return { label: t("tryAgain"), detail, danger: false, onPress: () => void store.retry(video.video_id) };
  if (item.state === "done") return { label: t("deleteFromPhone"), detail, danger: true, onPress: () => confirmDeleteDownload(video, t) };
  return { label: t("cancelDownload"), detail, danger: true, onPress: () => void store.remove(video.video_id) };
}

/** The row in a video's More sheet. */
export function PhoneDownloadSheetRow({ video, t, language, canStart }: { video: Video; t: Translate; language: Language; canStart: boolean }) {
  const action = useDownloadAction(video, t, language, canStart);
  return action ? <PhoneListRow title={action.label} detail={action.detail} danger={action.danger} onPress={action.onPress} /> : null;
}

/** The chip on a video's page: "Download to phone", or the download's state. */
export function PhoneDownloadChip({ video, t, language, canStart }: { video: Video; t: Translate; language: Language; canStart: boolean }) {
  const view = usePhoneDownloads();
  const item = view.available ? viewDownload(view, video.video_id) : null;
  const action = useDownloadAction(video, t, language, canStart);
  if (!action) return null;
  if (!item) return <PhoneChip label={action.label} onPress={action.onPress} />;
  // A started download shows where it stands; a tap offers the same choice as the sheet.
  if (item.state === "done") return <PhoneChip label={`✓ ${t("downloadedOnPhone")}`} onPress={action.onPress} />;
  const label = item.state === "failed" ? t("downloadToPhone") : downloadStatusLabel(item, t, language);
  return <PhoneChip label={`↓ ${label}`} onPress={() => Alert.alert(video.title, action.detail, [
    { text: t("close"), style: "cancel" },
    { text: action.label, style: action.danger ? "destructive" : "default", onPress: action.onPress },
  ])} />;
}
