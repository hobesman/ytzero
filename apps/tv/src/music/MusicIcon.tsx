import Svg, { Path, Rect } from "react-native-svg";

export type MusicIconName = "play" | "pause" | "next" | "previous" | "like" | "liked" | "dislike" | "note" | "sleep" | "down" | "shuffle" | "back" | "save" | "saved" | "station";

/** The music player's control glyphs. */
export function MusicIcon({ name, color, size = 24 }: { name: MusicIconName; color: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const svg = (children: React.ReactNode) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">{children}</Svg>;
  switch (name) {
    case "play": return svg(<Path d="M7 4.5v15l12-7.5z" fill={color} />);
    case "pause": return svg(<><Rect x="6" y="4.5" width="4" height="15" rx="1" fill={color} /><Rect x="14" y="4.5" width="4" height="15" rx="1" fill={color} /></>);
    case "next": return svg(<><Path d="M5 5v14l10-7z" fill={color} /><Rect x="16.5" y="5" width="2.5" height="14" rx="1" fill={color} /></>);
    case "previous": return svg(<><Path d="M19 5v14L9 12z" fill={color} /><Rect x="5" y="5" width="2.5" height="14" rx="1" fill={color} /></>);
    case "like": return svg(<Path d="M7 10v10H4V10zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.6-5A2 2 0 0 0 18.8 10H14l.7-3.1A2.5 2.5 0 0 0 12.3 4L7 10Z" {...stroke} />);
    case "liked": return svg(<Path d="M7 10v10H4V10zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.6-5A2 2 0 0 0 18.8 10H14l.7-3.1A2.5 2.5 0 0 0 12.3 4L7 10Z" {...stroke} fill={color} />);
    case "dislike": return svg(<Path d="M17 14V4h3v10zm0-9H6.8a2 2 0 0 0-1.9 1.4l-1.6 5A2 2 0 0 0 5.2 14H10l-.7 3.1a2.5 2.5 0 0 0 2.4 2.9L17 14Z" {...stroke} />);
    case "note": return svg(<Path d="M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" {...stroke} />);
    case "sleep": return svg(<Path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" {...stroke} />);
    case "down": return svg(<Path d="m6 9 6 6 6-6" {...stroke} />);
    case "shuffle": return svg(<Path d="M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5" {...stroke} />);
    case "back": return svg(<Path d="M15 5 8 12l7 7" {...stroke} />);
    case "save": return svg(<Path d="M12 5v14M5 12h14" {...stroke} />);
    case "saved": return svg(<Path d="m5 12.5 4.5 4.5L19 7.5" {...stroke} />);
    case "station": return svg(<Path d="M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" {...stroke} />);
  }
}
