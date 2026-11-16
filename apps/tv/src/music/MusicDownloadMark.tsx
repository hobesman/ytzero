import Svg, { Circle, Path } from "react-native-svg";
import { phoneColors } from "../phone/phoneTheme";
import { musicDownloadTrack, musicTrackProgress, type MusicDownloadProgress } from "./musicDownloads";
import { useMusicDownloads } from "./useMusicDownloads";

/** A download's glyph: an arrow, a ring filling as it downloads, or a filled check once saved. */
export function MusicDownloadGlyph({ progress, color, size = 18 }: { progress: MusicDownloadProgress; color: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (progress.state === "done") {
    return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="12" r="9" fill={color} />
      <Path d="m8 12.5 2.8 2.8L16.5 9.5" stroke={phoneColors.background} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>;
  }
  if (progress.state === "active") {
    const circumference = 2 * Math.PI * 9;
    const fraction = progress.fraction ?? 0.08;
    return <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={phoneColors.surfaceRaised} strokeWidth={2.4} fill="none" />
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`} transform="rotate(-90 12 12)" />
    </Svg>;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" {...stroke} /></Svg>;
}

/** A song's mark in a list once it is saved on the phone, or while it downloads. */
export function MusicTrackDownloadMark({ videoId }: { videoId: string }) {
  const view = useMusicDownloads();
  const progress = musicTrackProgress(musicDownloadTrack(view, videoId));
  if (progress.state !== "done" && progress.state !== "active") return null;
  return <MusicDownloadGlyph progress={progress} color={progress.state === "done" ? phoneColors.accent : phoneColors.textMuted} size={16} />;
}
