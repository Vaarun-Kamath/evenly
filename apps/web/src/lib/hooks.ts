import type { Member } from "@evenly/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { keys } from "./queries";

/** The `:gid` of the group route being shown. */
export function useGid(): string {
  const { gid } = useParams({ strict: false });
  if (gid === undefined) throw new Error("useGid needs a route with a :gid");
  return gid;
}

/**
 * Anything that changes a group can change many screens (lists, balances, the feed, the dashboard), so
 * after a change, drop them all and let the visible ones refetch.
 */
export function useRefreshGroup(gid: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.group(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.members(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.balances(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.allExpenses(gid) }),
      queryClient.invalidateQueries({ queryKey: ["expense", gid] }),
      queryClient.invalidateQueries({ queryKey: keys.settlements(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.invites(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.activity(gid) }),
      queryClient.invalidateQueries({ queryKey: keys.allGroups }),
      queryClient.invalidateQueries({ queryKey: keys.overview }),
    ]);
  }, [queryClient, gid]);
}

export function nameOf(members: readonly Member[], memberId: string): string {
  const member = members.find((m) => m.id === memberId);
  if (member === undefined) return "Someone";
  return member.leftAt === null ? member.displayName : `${member.displayName} (left)`;
}

/** "You" for yourself, the member's name for anyone else. */
export function whoIs(members: readonly Member[], memberId: string): string {
  return members.find((m) => m.id === memberId)?.isYou === true ? "You" : nameOf(members, memberId);
}
