import {
  createdInviteSchema,
  groupSchema,
  memberSchema,
  type CreatedInvite,
  type Group,
  type Invite,
  type Member,
} from "@evenly/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from "../../components/ui";
import { buttonClass } from "../../components/styles";
import { api, basePath, errorMessage } from "../../lib/api";
import { withBasePath } from "../../lib/basePath";
import { formatDateTime, money } from "../../lib/format";
import { useGid, useRefreshGroup } from "../../lib/hooks";
import { configQuery, groupQuery, invitesQuery, membersQuery } from "../../lib/queries";
import { useToast } from "../../lib/toast";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

/* ------------------------------------------------------------------- export */

function Export({ group }: { group: Group }) {
  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Export</h2>
      <p className="text-sm text-muted">
        Every expense and payment with each person’s share, and a summary of the balances, as a
        spreadsheet file (CSV).
      </p>
      <a
        className={buttonClass("secondary", "self-start")}
        href={withBasePath(basePath, `/api/v1/groups/${group.id}/export.csv`)}
        download
      >
        Download CSV
      </a>
    </Card>
  );
}

/* ------------------------------------------------------------ group details */

function Details({ group }: { group: Group }) {
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const canEdit = group.myRole !== "member" && group.archivedAt === null;
  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState(group.emoji ?? "");
  const [simplify, setSimplify] = useState(group.simplifyDebts);
  const [nameError, setNameError] = useState<string>();

  const save = useMutation({
    mutationFn: () =>
      api("PATCH", `/api/v1/groups/${group.id}`, {
        body: {
          name: name.trim(),
          emoji: emoji.trim() === "" ? null : emoji.trim(),
          simplifyDebts: simplify,
        },
        schema: groupSchema,
      }),
    onSuccess: async () => {
      await refresh();
      toast.show("Group settings saved.");
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api("POST", `/api/v1/groups/${group.id}/${archived ? "archive" : "unarchive"}`, {
        schema: groupSchema,
      }),
    onSuccess: async (_group, archived) => {
      await refresh();
      toast.show(archived ? "Group archived." : "Group unarchived.");
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setNameError("Give the group a name.");
    setNameError(undefined);
    save.mutate();
  }

  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Group</h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          disabled={!canEdit}
          maxLength={120}
        />
        <TextField
          label="Emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          disabled={!canEdit}
          maxLength={16}
        />
        <TextField
          label="Currency"
          value={group.currency}
          disabled
          hint="A group's currency cannot be changed."
          onChange={() => undefined}
        />
        <CheckboxField
          label="Simplify debts"
          hint="Suggest the fewest payments, even if it means paying someone who did not pay you."
          checked={simplify}
          disabled={!canEdit}
          onChange={(e) => setSimplify(e.target.checked)}
        />
        {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
        {canEdit && (
          <Button type="submit" loading={save.isPending} className="self-start">
            Save settings
          </Button>
        )}
        {group.myRole === "member" && (
          <p className="text-sm text-muted">Only admins can change these.</p>
        )}
      </form>
      {group.myRole !== "member" && (
        <div className="border-t border-line pt-4">
          {archive.isError && <Alert className="mb-3">{errorMessage(archive.error)}</Alert>}
          {group.archivedAt === null ? (
            <Button
              variant="secondary"
              onClick={() => archive.mutate(true)}
              loading={archive.isPending}
            >
              Archive group
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => archive.mutate(false)}
              loading={archive.isPending}
            >
              Unarchive group
            </Button>
          )}
          <p className="mt-2 text-xs text-muted">
            An archived group is read-only and drops off your main list. Nothing is deleted.
          </p>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- invite links */

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The Clipboard API needs https or localhost: the person can select the text instead.
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="invite-link">
        Invitation link
      </label>
      <input
        id="invite-link"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono text-xs"
      />
      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

function LinkDialog({
  invite,
  onClose,
}: {
  invite: CreatedInvite | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={invite !== undefined}
      onClose={onClose}
      title="Invitation link ready"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {invite !== undefined && (
        <div className="flex flex-col gap-3">
          <p>
            {invite.claimMember === null
              ? "Anyone with this link can join the group."
              : `Whoever opens this link can become ${invite.claimMember.displayName}, keeping everything recorded for them.`}{" "}
            It is shown only now, so copy it before closing.
          </p>
          <CopyableLink url={invite.url} />
          {invite.email !== null && (
            <p className="text-muted">It was also emailed to {invite.email}.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Invites({ group, emailEnabled }: { group: Group; emailEnabled: boolean }) {
  const invites = useQuery(invitesQuery(group.id));
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const readOnly = group.archivedAt !== null;
  const isAdmin = group.myRole !== "member";
  const [expiresIn, setExpiresIn] = useState("7d");
  const [maxUses, setMaxUses] = useState("");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<CreatedInvite>();

  const create = useMutation({
    mutationFn: () =>
      api("POST", `/api/v1/groups/${group.id}/invites`, {
        body: {
          expiresIn,
          ...(maxUses.trim() !== "" && { maxUses: Number(maxUses) }),
          ...(email.trim() !== "" && { email: email.trim() }),
        },
        schema: createdInviteSchema,
      }),
    onSuccess: async (invite) => {
      setCreated(invite);
      setEmail("");
      setMaxUses("");
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (invite: Invite) =>
      api("DELETE", `/api/v1/groups/${group.id}/invites/${invite.id}`),
    onSuccess: async () => {
      await refresh();
      toast.show("Invitation cancelled.");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Invitations</h2>
      {readOnly ? (
        <p className="text-sm text-muted">An archived group takes no new people.</p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <SelectField
            label="Link expires"
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
          >
            <option value="1d">In 1 day</option>
            <option value="7d">In 7 days</option>
            <option value="30d">In 30 days</option>
            <option value="never">Never</option>
          </SelectField>
          <TextField
            label="Maximum uses (optional)"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))}
            placeholder="No limit"
          />
          {emailEnabled && (
            <TextField
              label="Email it to (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="The link then works only for that address."
              className="sm:col-span-2"
            />
          )}
          <div className="sm:col-span-2">
            {create.isError && <Alert className="mb-3">{errorMessage(create.error)}</Alert>}
            <Button type="submit" loading={create.isPending}>
              Create invitation link
            </Button>
          </div>
        </form>
      )}

      {invites.isPending && <Loading label="Loading invitations" />}
      {invites.isError && <ErrorState message={errorMessage(invites.error)} />}
      {invites.isSuccess && invites.data.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-line pt-4">
          {invites.data.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={invite.status === "active" ? "strong" : "neutral"}>
                    {invite.status}
                  </Badge>
                  {invite.claimMember !== null && <span>for {invite.claimMember.displayName}</span>}
                  {invite.email !== null && <span className="truncate">{invite.email}</span>}
                </p>
                <p className="mt-1 text-xs text-muted">
                  By {invite.createdBy.displayName}, {formatDateTime(invite.createdAt)} · used{" "}
                  {invite.useCount}
                  {invite.maxUses !== null && ` of ${String(invite.maxUses)}`} ·{" "}
                  {invite.expiresAt === null
                    ? "never expires"
                    : `expires ${formatDateTime(invite.expiresAt)}`}
                </p>
              </div>
              {isAdmin && invite.status === "active" && !readOnly && (
                <Button
                  variant="danger"
                  className="min-h-9 px-3"
                  onClick={() => revoke.mutate(invite)}
                  loading={revoke.isPending && revoke.variables === invite}
                >
                  Cancel link
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <LinkDialog invite={created} onClose={() => setCreated(undefined)} />
    </Card>
  );
}

/* ------------------------------------------------------------------ members */

function MemberRow({ group, member }: { group: Group; member: Member }) {
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const navigate = useNavigate();
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(member.displayName);
  const [confirm, setConfirm] = useState<"remove" | "handover">();
  const [link, setLink] = useState<CreatedInvite>();
  const mine = group.myRole;
  const readOnly = group.archivedAt !== null;
  const left = member.leftAt !== null;

  const patch = useMutation({
    mutationFn: (body: object) =>
      api("PATCH", `/api/v1/groups/${group.id}/members/${member.id}`, {
        body,
        schema: memberSchema,
      }),
    onSuccess: async () => {
      setRename(false);
      setConfirm(undefined);
      await refresh();
      toast.show("Saved.");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/api/v1/groups/${group.id}/members/${member.id}`),
    onSuccess: async () => {
      setConfirm(undefined);
      await refresh();
      if (member.isYou) {
        toast.show("You left the group.");
        await navigate({ to: "/" });
      } else {
        toast.show(`${member.displayName} was removed.`);
      }
    },
  });
  const claimLink = useMutation({
    mutationFn: () =>
      api("POST", `/api/v1/groups/${group.id}/invites`, {
        body: { claimMemberId: member.id, expiresIn: "30d" },
        schema: createdInviteSchema,
      }),
    onSuccess: async (invite) => {
      setLink(invite);
      await refresh();
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const canRename = member.isPlaceholder && mine !== "member" && !readOnly;
  const canRemove =
    !readOnly &&
    !left &&
    member.role !== "owner" &&
    (member.isYou || (mine === "owner" ? true : mine === "admin" && member.role === "member"));
  const canChangeRole =
    mine === "owner" && !member.isYou && !member.isPlaceholder && !left && !readOnly;

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="font-medium">{member.displayName}</span>
          {member.isYou && <span className="text-muted"> (you)</span>}{" "}
          <Badge tone={member.role === "member" ? "neutral" : "strong"}>
            {ROLE_LABEL[member.role]}
          </Badge>{" "}
          {member.isPlaceholder && <Badge>No account yet</Badge>} {left && <Badge>Left</Badge>}
        </p>
        <p className="text-sm tabular-nums">
          {member.net.amountMinor === 0
            ? "settled up"
            : member.net.amountMinor > 0
              ? `is owed ${money(member.net.amountMinor, group.currency)}`
              : `owes ${money(-member.net.amountMinor, group.currency)}`}
        </p>
      </div>
      {member.email !== null && <p className="text-xs text-muted">{member.email}</p>}
      {(canRename || canRemove || canChangeRole || (member.isPlaceholder && !readOnly)) && (
        <div className="flex flex-wrap items-center gap-2">
          {canChangeRole && (
            <>
              <label className="sr-only" htmlFor={`role-${member.id}`}>
                Role of {member.displayName}
              </label>
              <select
                id={`role-${member.id}`}
                value={member.role}
                disabled={patch.isPending}
                onChange={(e) =>
                  e.target.value === "owner"
                    ? setConfirm("handover")
                    : patch.mutate({ role: e.target.value })
                }
                className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Make owner…</option>
              </select>
            </>
          )}
          {member.isPlaceholder && !readOnly && (
            <Button
              variant="secondary"
              className="min-h-9 px-3"
              onClick={() => claimLink.mutate()}
              loading={claimLink.isPending}
            >
              Invite them to take this place
            </Button>
          )}
          {canRename && (
            <Button variant="secondary" className="min-h-9 px-3" onClick={() => setRename(true)}>
              Rename
            </Button>
          )}
          {canRemove && (
            <Button variant="danger" className="min-h-9 px-3" onClick={() => setConfirm("remove")}>
              {member.isYou ? "Leave group" : "Remove"}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={rename}
        onClose={() => setRename(false)}
        title={`Rename ${member.displayName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRename(false)}>
              Cancel
            </Button>
            <Button
              loading={patch.isPending}
              onClick={() => name.trim() !== "" && patch.mutate({ displayName: name.trim() })}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </Dialog>

      <ConfirmDialog
        open={confirm === "remove"}
        title={member.isYou ? "Leave this group?" : `Remove ${member.displayName}?`}
        confirmLabel={member.isYou ? "Leave group" : "Remove"}
        busy={remove.isPending}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => remove.mutate()}
      >
        <p>
          {member.isYou
            ? "You will no longer see this group. You can only leave when you are settled up."
            : `${member.displayName} stays in the history as "(left)". They can only be removed when they are settled up.`}
        </p>
        {remove.isError && <Alert className="mt-3">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "handover"}
        title={`Make ${member.displayName} the owner?`}
        confirmLabel="Hand over the group"
        busy={patch.isPending}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => patch.mutate({ role: "owner" })}
      >
        <p>You become an admin. Only the owner can delete the group or change roles.</p>
      </ConfirmDialog>

      <LinkDialog invite={link} onClose={() => setLink(undefined)} />
    </li>
  );
}

function Members({ group, members }: { group: Group; members: Member[] }) {
  const refresh = useRefreshGroup(group.id);
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const readOnly = group.archivedAt !== null;

  const add = useMutation({
    mutationFn: () =>
      api("POST", `/api/v1/groups/${group.id}/members`, {
        body: { displayName: name.trim(), ...(email.trim() !== "" && { email: email.trim() }) },
        schema: memberSchema,
      }),
    onSuccess: async (member) => {
      setName("");
      setEmail("");
      await refresh();
      toast.show(`${member.displayName} added. You can add them to expenses straight away.`);
    },
  });

  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">People</h2>
      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <MemberRow key={member.id} group={group} member={member} />
        ))}
      </ul>
      {!readOnly && (
        <form
          noValidate
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "") return setError("Enter a name.");
            setError(undefined);
            add.mutate();
          }}
        >
          <h3 className="text-sm font-medium">Add someone who does not have an account yet</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
              maxLength={100}
            />
            <TextField
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {add.isError && <Alert>{errorMessage(add.error)}</Alert>}
          <Button type="submit" variant="secondary" loading={add.isPending} className="self-start">
            Add person
          </Button>
        </form>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- danger zone */

function DeleteGroup({ group }: { group: Group }) {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshGroup(group.id);
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/api/v1/groups/${group.id}`),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
      toast.show("Group deleted.");
      await navigate({ to: "/" });
    },
  });
  if (group.myRole !== "owner") return null;
  return (
    <Card as="section" className="flex flex-col gap-3 border-danger">
      <h2 className="text-lg font-semibold text-danger">Delete group</h2>
      <p className="text-sm">
        Deleting removes the group for everyone. It is only possible when everyone is settled up.
      </p>
      <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>
        Delete group…
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete ${group.name}?`}
        confirmLabel="Delete group"
        busy={remove.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => remove.mutate()}
      >
        <p>This cannot be undone from the app.</p>
        {remove.isError && <Alert className="mt-3">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>
    </Card>
  );
}

/* -------------------------------------------------------------------- page */

export function SettingsPage() {
  const gid = useGid();
  const group = useQuery(groupQuery(gid));
  const members = useQuery(membersQuery(gid));
  const config = useQuery(configQuery);

  if (group.isPending || members.isPending) return <Loading label="Loading settings" />;
  if (group.isError || members.isError)
    return <ErrorState message={errorMessage(group.error ?? members.error)} />;
  return (
    <>
      <PageHeader
        title="Group settings"
        subtitle={`${group.data.emoji ?? ""} ${group.data.name}`.trim()}
        back={
          <Link to="/g/$gid" params={{ gid }} className="text-sm underline underline-offset-4">
            Back to the group
          </Link>
        }
      />
      {members.data.length === 0 && <EmptyState title="No people" />}
      <div className="flex flex-col gap-6">
        <Details group={group.data} />
        <Members group={group.data} members={members.data} />
        <Invites group={group.data} emailEnabled={config.data?.emailEnabled === true} />
        <Export group={group.data} />
        <DeleteGroup group={group.data} />
      </div>
    </>
  );
}
