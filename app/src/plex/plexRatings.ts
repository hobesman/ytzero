/**
 * Age ratings for the room tablet's Plex tab. Movie (MPA) and TV (US TV
 * Parental Guidelines) ratings share four levels, so one choice covers both
 * libraries: "pg" lets through G, PG, TV-Y, TV-Y7, TV-G and TV-PG. A level
 * includes every level below it. A title with no rating, or one this doesn't
 * know, shows only under "all".
 */
export const PLEX_RATING_LEVELS = ["g", "pg", "pg13", "r", "all"] as const;
export type PlexRatingLevel = (typeof PLEX_RATING_LEVELS)[number];

const LEVEL_OF: Record<string, Exclude<PlexRatingLevel, "all">> = {
  // US movies and TV.
  "G": "g", "TV-Y": "g", "TV-Y7": "g", "TV-Y7-FV": "g", "TV-G": "g",
  "PG": "pg", "TV-PG": "pg",
  "PG-13": "pg13", "TV-14": "pg13",
  "R": "r", "NC-17": "r", "TV-MA": "r",
  // British and Canadian ratings Plex often gives, as "gb/12A" or "ca/14A".
  "U": "g", "12": "pg13", "12A": "pg13", "14A": "pg13", "15": "r", "18": "r", "18A": "r", "R18": "r",
};

export function parsePlexRatingLevel(value: string | null | undefined): PlexRatingLevel | null {
  return PLEX_RATING_LEVELS.find((level) => level === value) ?? null;
}

/** Where a Plex content rating sits, or null when it has none this knows. */
export function plexRatingLevel(contentRating: string): Exclude<PlexRatingLevel, "all"> | null {
  const rating = contentRating.trim().replace(/^[a-z]{2}\//i, "").toUpperCase();
  return Object.hasOwn(LEVEL_OF, rating) ? LEVEL_OF[rating]! : null;
}

/** Whether a title with this content rating shows at this level. */
export function plexRatingAllowed(contentRating: string, level: PlexRatingLevel): boolean {
  if (level === "all") return true;
  const found = plexRatingLevel(contentRating);
  return found !== null && PLEX_RATING_LEVELS.indexOf(found) <= PLEX_RATING_LEVELS.indexOf(level);
}
