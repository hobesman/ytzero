import type { AlexaResponse } from "./alexaPlayback";
import { speak } from "./alexaPlayback";
import type { AlexaChannel } from "./alexaVideoCatalog";
import { CHANNEL_MATCH_MIN, channelScore } from "./alexaVideoMatch";

/**
 * Following and unfollowing channels by voice. Nothing changes without a yes:
 * the skill offers one channel at a time, YouTube's matches for a search or
 * the profile's followed channels for an unfollow, and moves to the next on a
 * no. The offer travels in the Alexa session's attributes, so the server keeps
 * nothing between turns.
 */
export interface ChannelCandidate {
  channelId: string;
  title: string;
  /** As YouTube shows it, such as "2.1M subscribers"; empty when unknown. */
  subscribers?: string;
  followed?: boolean;
}

export interface ChannelDialogDependencies {
  searchChannels: (userId: number, query: string) => Promise<ChannelCandidate[]>;
  followedChannels: (userId: number) => Promise<AlexaChannel[]>;
  follow: (userId: number, channel: ChannelCandidate) => Promise<void>;
  unfollow: (userId: number, channelId: string) => Promise<void>;
}

/** What a yes or no answers; kept in the session's attributes. */
export interface ChannelOffer {
  action: "follow" | "unfollow";
  candidates: ChannelCandidate[];
  index: number;
}

export const MAX_CANDIDATES = 10;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const YES_NO = "Say yes or no.";

/** "2.1M subscribers" as Alexa should say it: "2.1 million subscribers". */
export function spokenCount(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/(\d+(?:[.,]\d+)?)\s*([KMB])\b/gi, (_, number: string, unit: string) =>
    `${number} ${{ k: "thousand", m: "million", b: "billion" }[unit.toLowerCase() as "k" | "m" | "b"]}`);
}

export function readOffer(attributes: unknown): ChannelOffer | null {
  const offer = (attributes as { channelOffer?: Partial<ChannelOffer> } | undefined)?.channelOffer;
  if (!offer || (offer.action !== "follow" && offer.action !== "unfollow") || !Array.isArray(offer.candidates)) return null;
  const candidates = offer.candidates.filter((candidate): candidate is ChannelCandidate =>
    typeof candidate?.channelId === "string" && /^[A-Za-z0-9_-]{2,40}$/.test(candidate.channelId) && typeof candidate.title === "string")
    .slice(0, MAX_CANDIDATES);
  const index = Number(offer.index);
  if (!candidates.length || !Number.isInteger(index) || index < 0 || index >= candidates.length) return null;
  return { action: offer.action, candidates, index };
}

function ask(offer: ChannelOffer, text: string): AlexaResponse {
  return { ...speak(text, YES_NO), sessionAttributes: { channelOffer: offer } };
}

/** The question for the candidate at `offer.index`. */
function offerText(offer: ChannelOffer): string {
  const candidate = offer.candidates[offer.index];
  const subscribers = spokenCount(candidate.subscribers);
  const name = subscribers ? `${candidate.title}, with ${subscribers}` : candidate.title;
  const single = offer.candidates.length === 1;
  if (offer.action === "unfollow") return `Unfollow ${candidate.title}?`;
  const which = single ? "I found" : `The ${ORDINALS[offer.index] ?? "next"} match is`;
  if (candidate.followed) return `${which} ${name}, which you already follow.${single ? "" : " Hear the next match?"}`;
  return `${which} ${name}. Follow it?`;
}

export function createChannelDialog(dependencies: ChannelDialogDependencies) {
  const present = (offer: ChannelOffer) => {
    const candidate = offer.candidates[offer.index];
    // A lone match that's already followed leaves nothing to ask.
    if (candidate.followed && offer.candidates.length === 1) return speak(offerText(offer));
    return ask(offer, offerText(offer));
  };

  /** "Find the channel <name>": YouTube's matches, one at a time. */
  async function find(userId: number, query: string): Promise<AlexaResponse> {
    const followed = new Set((await dependencies.followedChannels(userId)).map((channel) => channel.channelId));
    const found = (await dependencies.searchChannels(userId, query)).slice(0, MAX_CANDIDATES)
      .map((candidate) => ({ ...candidate, followed: followed.has(candidate.channelId) }));
    if (!found.length) return speak(`I couldn't find a channel called ${query}.`);
    return present({ action: "follow", candidates: found, index: 0 });
  }

  /** Follow the channel of what's playing, after a yes. */
  async function followChannel(userId: number, channel: ChannelCandidate | null): Promise<AlexaResponse> {
    if (!channel) return speak("Nothing is playing, so I don't know which channel you mean. Say find the channel, then its name.");
    const followed = (await dependencies.followedChannels(userId)).some((item) => item.channelId === channel.channelId);
    if (followed) return speak(`You already follow ${channel.title}.`);
    const offer: ChannelOffer = { action: "follow", candidates: [channel], index: 0 };
    return ask(offer, `Follow ${channel.title}?`);
  }

  /** "Unfollow <name>": the followed channels that match, best first. */
  async function unfollow(userId: number, spoken: string): Promise<AlexaResponse> {
    const matches = (await dependencies.followedChannels(userId))
      .map((channel) => ({ channel, score: channelScore(spoken, channel.title) }))
      .filter((match) => match.score >= CHANNEL_MATCH_MIN)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ channel }) => ({ channelId: channel.channelId, title: channel.title }));
    if (!matches.length) return speak(`You don't follow a channel called ${spoken}.`);
    return present({ action: "unfollow", candidates: matches, index: 0 });
  }

  async function unfollowChannel(userId: number, channel: ChannelCandidate | null): Promise<AlexaResponse> {
    if (!channel) return speak("Nothing is playing, so I don't know which channel you mean. Say unfollow, then the channel's name.");
    const followed = (await dependencies.followedChannels(userId)).some((item) => item.channelId === channel.channelId);
    if (!followed) return speak(`You don't follow ${channel.title}.`);
    return present({ action: "unfollow", candidates: [channel], index: 0 });
  }

  async function answer(userId: number, attributes: unknown, yes: boolean): Promise<AlexaResponse | null> {
    const offer = readOffer(attributes);
    if (!offer) return null;
    const candidate = offer.candidates[offer.index];
    // For a channel already followed, yes means "go on to the next match".
    if (yes && !candidate.followed) {
      if (offer.action === "follow") {
        await dependencies.follow(userId, candidate);
        return speak(`Now following ${candidate.title}.`);
      }
      await dependencies.unfollow(userId, candidate.channelId);
      return speak(`Unfollowed ${candidate.title}.`);
    }
    if (!yes && candidate.followed) return speak("Okay.");
    const next = offer.index + 1;
    if (next >= offer.candidates.length) {
      return speak(offer.action === "follow" ? "That's all the matches I found. Nothing was changed." : "Okay, nothing was changed.");
    }
    return present({ ...offer, index: next });
  }

  return { find, followChannel, unfollow, unfollowChannel, answer };
}
