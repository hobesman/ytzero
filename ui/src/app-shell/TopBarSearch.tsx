import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MonitorPlay, Music, Search } from "lucide-react";
import { useI18n } from "../i18n";
import { type SearchMode, searchModeForPath, searchPath } from "../searchMode";
import "./TopBarSearch.css";

/**
 * The top-bar search. It searches music on music pages and videos everywhere
 * else; the button at its start flips that for the next search only, so a flip
 * left unused never carries over to another page.
 */
export default function TopBarSearch({ musicAvailable }: { musicAvailable: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [picked, setPicked] = useState<{ mode: SearchMode; at: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const pageMode: SearchMode = musicAvailable ? searchModeForPath(location.pathname) : "videos";
  // Tied to the location it was made on: any navigation, a search included, drops it.
  const mode = picked?.at === location.key ? picked.mode : pageMode;
  const music = mode === "music";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(searchPath(mode, q));
  };

  const flip = () => {
    setPicked({ mode: music ? "videos" : "music", at: location.key });
    inputRef.current?.focus();
  };

  return (
    <form className={`search-wrap${musicAvailable ? " search-wrap--with-mode" : ""}${music ? " search-wrap--music" : ""}`} role="search" onSubmit={submit}>
      {musicAvailable ? (
        <button
          type="button"
          className="search-mode-btn"
          onClick={flip}
          aria-label={music ? t("searchModeSwitchToVideos") : t("searchModeSwitchToMusic")}
          title={music ? t("searchModeSwitchToVideos") : t("searchModeSwitchToMusic")}
        >
          {music ? <Music /> : <MonitorPlay />}
        </button>
      ) : null}
      <input
        ref={inputRef}
        placeholder={music ? t("musicSearchPlaceholder") : t("searchModeVideosPlaceholder")}
        aria-label={music ? t("musicSearchPlaceholder") : t("searchModeVideosPlaceholder")}
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <button type="submit" className="search-btn" aria-label={t("search")}>
        <Search />
      </button>
    </form>
  );
}
