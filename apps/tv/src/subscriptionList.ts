import type { Channel } from "./types";

export type SubscriptionSort = "name" | "latest";

/** Followed channels matching `query` (title or handle), by name or by latest upload (newest first). */
export function subscriptionList(channels: readonly Channel[], query: string, sort: SubscriptionSort): Channel[] {
  const needle = query.trim().toLocaleLowerCase();
  const matching = channels.filter((channel) => channel.followed !== 0 && (!needle
    || channel.title.toLocaleLowerCase().includes(needle) || (channel.handle ?? "").toLocaleLowerCase().includes(needle)));
  const byName = (a: Channel, b: Channel) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  if (sort === "name") return matching.sort(byName);
  const time = (channel: Channel) => channel.latest_video_at ? Date.parse(channel.latest_video_at) || 0 : 0;
  return matching.sort((a, b) => time(b) - time(a) || byName(a, b));
}
