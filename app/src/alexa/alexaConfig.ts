import { database } from "../database";

/**
 * A private Alexa skill, configured only by machine-bound environment
 * variables: nothing here lives in the database, settings or backups.
 */
export interface AlexaConfig {
  /** The music skill's application ID, when there is one. */
  musicSkillId: string | null;
  /** The video skill's application ID, when there is one. Requests from any other skill are refused. */
  videoSkillId: string | null;
  /** The audiobook skill's (Hoban Books) application ID, when there is one. */
  booksSkillId?: string | null;
  /** The movie skill's (Hoban Plex) application ID, when there is one. */
  moviesSkillId?: string | null;
  /** The profile the skill plays as: its numeric ID or its name. */
  profile: string;
  /** Signs the audio links handed to Alexa. */
  secret: string;
  /** The public HTTPS origin Amazon fetches audio from, e.g. https://ytzero.example.com. */
  publicUrl: string;
}

type Environment = Record<string, string | undefined>;

export const ALEXA_SECRET_MIN_LENGTH = 32;

/** The configuration, or why the skill is off. */
export function alexaConfig(environment: Environment = process.env): AlexaConfig | { disabled: string } {
  // A list-form compose entry (- KEY="value") keeps the quotes as part of the value.
  const quoted = ALEXA_VARIABLES.find((key) => /^\s*(["']).*\1\s*$/.test(environment[key] ?? ""));
  if (quoted) return { disabled: `${quoted} is wrapped in quote marks; remove them` };
  const musicSkillId = environment.YTZERO_ALEXA_SKILL_ID?.trim() || null;
  const videoSkillId = environment.YTZERO_ALEXA_VIDEO_SKILL_ID?.trim() || null;
  const booksSkillId = environment.YTZERO_ALEXA_BOOKS_SKILL_ID?.trim() || null;
  const moviesSkillId = environment.YTZERO_ALEXA_MOVIES_SKILL_ID?.trim() || null;
  const ids = [musicSkillId, videoSkillId, booksSkillId, moviesSkillId].filter(Boolean);
  if (!ids.length) return { disabled: "none of YTZERO_ALEXA_SKILL_ID, YTZERO_ALEXA_VIDEO_SKILL_ID, YTZERO_ALEXA_BOOKS_SKILL_ID or YTZERO_ALEXA_MOVIES_SKILL_ID is set" };
  if (new Set(ids).size !== ids.length) return { disabled: "YTZERO_ALEXA_SKILL_ID, YTZERO_ALEXA_VIDEO_SKILL_ID, YTZERO_ALEXA_BOOKS_SKILL_ID and YTZERO_ALEXA_MOVIES_SKILL_ID must be different skills" };
  const profile = environment.YTZERO_ALEXA_PROFILE?.trim() ?? "";
  if (!profile) return { disabled: "YTZERO_ALEXA_PROFILE is not set" };
  const secret = environment.YTZERO_ALEXA_SECRET?.trim() ?? "";
  if (secret.length < ALEXA_SECRET_MIN_LENGTH) return { disabled: `YTZERO_ALEXA_SECRET must be at least ${ALEXA_SECRET_MIN_LENGTH} characters` };
  const publicUrl = (environment.YTZERO_ALEXA_PUBLIC_URL ?? environment.APP_URL ?? "").trim().replace(/\/+$/, "");
  let parsed: URL | null = null;
  try { parsed = publicUrl ? new URL(publicUrl) : null; } catch { parsed = null; }
  if (!parsed || parsed.protocol !== "https:") return { disabled: "APP_URL (or YTZERO_ALEXA_PUBLIC_URL) must be the server's public https:// address" };
  return { musicSkillId, videoSkillId, ...(booksSkillId ? { booksSkillId } : {}), ...(moviesSkillId ? { moviesSkillId } : {}), profile, secret, publicUrl: parsed.origin + parsed.pathname.replace(/\/+$/, "") };
}

const ALEXA_VARIABLES = [
  "YTZERO_ALEXA_SKILL_ID", "YTZERO_ALEXA_VIDEO_SKILL_ID", "YTZERO_ALEXA_BOOKS_SKILL_ID", "YTZERO_ALEXA_MOVIES_SKILL_ID", "YTZERO_ALEXA_PROFILE", "YTZERO_ALEXA_SECRET",
  "YTZERO_ALEXA_PUBLIC_URL", "APP_URL",
];

/**
 * What the log should say at startup: that the skill is on, or, once any
 * YTZERO_ALEXA_* variable is set, why it is still off. A server with no Alexa
 * configuration says nothing.
 */
export function alexaStartupStatus(environment: Environment = process.env): { event: "alexa.enabled"; fields: Record<string, string> } | { event: "alexa.disabled"; fields: Record<string, string> } | null {
  const settings = alexaConfig(environment);
  if (!("disabled" in settings)) {
    const skills = [settings.musicSkillId && "music", settings.videoSkillId && "video", settings.booksSkillId && "books", settings.moviesSkillId && "movies"].filter(Boolean).join(", ");
    return { event: "alexa.enabled", fields: { profile: settings.profile, endpoint: `${settings.publicUrl}/alexa`, skills } };
  }
  const attempted = Object.keys(environment).some((key) => key.startsWith("YTZERO_ALEXA_") && environment[key]?.trim());
  return attempted ? { event: "alexa.disabled", fields: { reason: settings.disabled } } : null;
}

/** The configured profile's ID, by ID or case-insensitive name. */
export async function resolveAlexaProfile(profile: string): Promise<number | null> {
  if (/^\d+$/.test(profile)) {
    const row = await database.prepare("SELECT id FROM users WHERE id = ?").get<{ id: number }>(Number(profile));
    if (row) return row.id;
  }
  const row = await database.prepare("SELECT id FROM users WHERE lower(name) = lower(?) ORDER BY id LIMIT 1").get<{ id: number }>(profile);
  return row?.id ?? null;
}
