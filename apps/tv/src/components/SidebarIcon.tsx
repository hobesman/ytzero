import Svg, { Circle, Path } from "react-native-svg";
import type { TvNavigationIcon } from "../navigation";

type Props = {
  color: string;
  name: TvNavigationIcon | "more" | "subscriptions";
  size?: number;
};

export function SidebarIcon({ color, name, size = 29 }: Props) {
  if (name === "search") return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="10" cy="10" r="6.5" stroke={color} strokeWidth="1.8" /><Path d="m15 15 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;
  if (name === "home") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="m3 10.8 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  if (name === "recommendations") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" /></Svg>;
  }
  if (name === "shorts") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M8 3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" stroke={color} strokeWidth="1.8" /><Path d="m10 9 5 3-5 3z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" /></Svg>;
  }
  if (name === "live") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="2" fill={color} /><Path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;
  }
  if (name === "watchlist") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Path d="M12 7v5l3.5 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "playlists") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M4 6h11M4 11h11M4 16h7M17 14v6l4-3z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "downloads") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "liked") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M7 10v10H4V10zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.6-5A2 2 0 0 0 18.8 10H14l.7-3.1A2.5 2.5 0 0 0 12.3 4L7 10Z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "history") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "bookmarks") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21l-5-3-5 3z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" /></Svg>;
  }
  if (name === "archive") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M4 7h16v13H4zM3 4h18v3H3zm6 8h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  }
  if (name === "subscriptions") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.8" />
      </Svg>
    );
  }
  if (name === "settings") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M4 7h5M15 7h5M4 17h9M19 17h1" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <Circle cx="12" cy="7" r="3" stroke={color} strokeWidth="1.8" />
        <Circle cx="16" cy="17" r="3" stroke={color} strokeWidth="1.8" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m6 9 6 6 6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
