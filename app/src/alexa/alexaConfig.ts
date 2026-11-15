import { database } from "../database";

/**
 * A private Alexa skill, configured only by machine-bound environment
 * variables: nothing here lives in the database, settings or backups.
 */
export interface AlexaConfig {
  /** The skill's application ID; requests from any other skill are refused. */
  skillId: string;
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
  const skillId = environment.YTZERO_ALEXA_SKILL_ID?.trim() ?? "";
  if (!skillId) return { disabled: "YTZERO_ALEXA_SKILL_ID is not set" };
  const profile = environment.YTZERO_ALEXA_PROFILE?.trim() ?? "";
  if (!profile) return { disabled: "YTZERO_ALEXA_PROFILE is not set" };
  const secret = environment.YTZERO_ALEXA_SECRET?.trim() ?? "";
  if (secret.length < ALEXA_SECRET_MIN_LENGTH) return { disabled: `YTZERO_ALEXA_SECRET must be at least ${ALEXA_SECRET_MIN_LENGTH} characters` };
  const publicUrl = (environment.YTZERO_ALEXA_PUBLIC_URL ?? environment.APP_URL ?? "").trim().replace(/\/+$/, "");
  let parsed: URL | null = null;
  try { parsed = publicUrl ? new URL(publicUrl) : null; } catch { parsed = null; }
  if (!parsed || parsed.protocol !== "https:") return { disabled: "APP_URL (or YTZERO_ALEXA_PUBLIC_URL) must be the server's public https:// address" };
  return { skillId, profile, secret, publicUrl: parsed.origin + parsed.pathname.replace(/\/+$/, "") };
}

/**
 * What the log should say at startup: that the skill is on, or, once any
 * YTZERO_ALEXA_* variable is set, why it is still off. A server with no Alexa
 * configuration says nothing.
 */
export function alexaStartupStatus(environment: Environment = process.env): { event: "alexa.enabled"; fields: Record<string, string> } | { event: "alexa.disabled"; fields: Record<string, string> } | null {
  const settings = alexaConfig(environment);
  if (!("disabled" in settings)) return { event: "alexa.enabled", fields: { profile: settings.profile, endpoint: `${settings.publicUrl}/alexa` } };
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
