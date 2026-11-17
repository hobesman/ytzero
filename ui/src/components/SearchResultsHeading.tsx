import { MonitorPlay, Music } from "lucide-react";
import { useI18n } from "../i18n";
import { type SearchMode, searchPath } from "../searchMode";
import { ButtonLink } from "./ui";
import "./SearchResultsHeading.css";

/**
 * "Results for: X" above search results, with a link that runs the same search
 * in the other mode, for when the mode turns out to be the wrong one.
 */
export default function SearchResultsHeading({ query, mode, offerOther = true }: { query: string; mode: SearchMode; offerOther?: boolean }) {
  const { t } = useI18n();
  const other: SearchMode = mode === "music" ? "videos" : "music";
  return (
    <div className="search-results-heading">
      <p className="search-info">{t("searchResultsFor")} <b>{query}</b></p>
      {offerOther ? (
        <ButtonLink size="sm" variant="ghost" to={searchPath(other, query)} leadingIcon={other === "music" ? <Music /> : <MonitorPlay />}>
          {other === "music" ? t("searchModeTryMusic", { query }) : t("searchModeTryVideos", { query })}
        </ButtonLink>
      ) : null}
    </div>
  );
}
