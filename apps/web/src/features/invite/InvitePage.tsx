import { acceptInviteResponseSchema } from "@evenly/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Alert, Button, Card, LinkButton, Loading } from "../../components/ui";
import { ApiError, api, errorMessage } from "../../lib/api";
import { auth } from "../../lib/auth";
import { invitePreviewQuery, keys, meQuery } from "../../lib/queries";
import { useToast } from "../../lib/toast";

/** The landing page for an invitation link: what it is for, and a way to join. */
export function InvitePage() {
  const { token = "" } = useParams({ strict: false });
  const preview = useQuery(invitePreviewQuery(token));
  const me = useQuery(meQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const here = `/invite/${token}`;

  const accept = useMutation({
    mutationFn: () =>
      api("POST", `/api/v1/invites/${token}/accept`, { schema: acceptInviteResponseSchema }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: keys.allGroups });
      await queryClient.invalidateQueries({ queryKey: keys.overview });
      toast.show(
        result.alreadyMember
          ? "You are already in this group."
          : result.claimed
            ? "You took your place in the group."
            : "You joined the group.",
      );
      await navigate({ to: "/g/$gid", params: { gid: result.groupId } });
    },
  });
  const switchAccount = useMutation({
    mutationFn: () => auth.signOut(),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login", search: { next: here } });
    },
  });

  if (preview.isPending) return <Loading label="Opening the invitation" />;
  if (preview.isError) {
    const error = preview.error;
    const gone = error instanceof ApiError && error.status === 410;
    return (
      <Card as="section" className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {gone ? "This link no longer works" : "We could not find that invitation"}
        </h1>
        <Alert tone="info">{errorMessage(error)}</Alert>
        <p className="text-sm text-muted">Ask the person who invited you for a new link.</p>
        <LinkButton to="/" variant="secondary">
          Go to your groups
        </LinkButton>
      </Card>
    );
  }

  const { group, invitedBy, claim } = preview.data;
  const signedIn = me.isSuccess;
  return (
    <Card as="section" className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{invitedBy} invited you to join</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {group.emoji !== null && <span aria-hidden="true">{group.emoji} </span>}
          {group.name}
        </h1>
        <p className="text-sm text-muted">
          {group.memberCount} {group.memberCount === 1 ? "person is" : "people are"} in the group.
        </p>
      </div>
      {claim !== null && (
        <Alert tone="info">
          This link is for <strong>{claim.displayName}</strong>. When you join, you take their
          place, and everything already recorded for them becomes yours.
        </Alert>
      )}

      {signedIn ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Joining as <strong>{me.data.name}</strong> ({me.data.email}).
          </p>
          {accept.isError && (
            <Alert>
              {errorMessage(accept.error)}
              {accept.error instanceof ApiError &&
                accept.error.code === "invite-email-mismatch" && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="font-medium underline underline-offset-4"
                      onClick={() => switchAccount.mutate()}
                    >
                      Log in with a different account
                    </button>
                  </>
                )}
            </Alert>
          )}
          <Button onClick={() => accept.mutate()} loading={accept.isPending}>
            {claim === null ? "Join group" : `Take ${claim.displayName}’s place`}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Create an account or log in to join.</p>
          <LinkButton to="/signup" search={{ invite: token, next: here }}>
            Create an account
          </LinkButton>
          <LinkButton to="/login" search={{ next: here }} variant="secondary">
            I already have an account
          </LinkButton>
        </div>
      )}
      <Link to="/" className="text-center text-sm underline underline-offset-4">
        Not now
      </Link>
    </Card>
  );
}
