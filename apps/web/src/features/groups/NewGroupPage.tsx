import { CURRENCY_EXPONENTS } from "@evenly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  PageHeader,
  SelectField,
  TextField,
} from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { currencyLabel } from "../../lib/format";
import { keys, meQuery } from "../../lib/queries";
import { groupSchema, meResponseSchema } from "@evenly/contracts";

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).sort();

export function NewGroupPage() {
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [currency, setCurrency] = useState<string>();
  const [simplify, setSimplify] = useState(true);
  const [nameError, setNameError] = useState<string>();

  const chosenCurrency = currency ?? me.data?.defaultCurrency ?? "USD";

  const create = useMutation({
    mutationFn: async () => {
      const group = await api("POST", "/api/v1/groups", {
        body: {
          name: name.trim(),
          currency: chosenCurrency,
          emoji: emoji.trim() === "" ? null : emoji.trim(),
          simplifyDebts: simplify,
        },
        schema: groupSchema,
      });
      // The first group's currency becomes the default for the next ones.
      if (me.data?.defaultCurrency === null) {
        await api("PATCH", "/api/v1/me", {
          body: { defaultCurrency: chosenCurrency },
          schema: meResponseSchema,
        });
        await queryClient.invalidateQueries({ queryKey: keys.me });
      }
      return group;
    },
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: keys.allGroups });
      await navigate({ to: "/g/$gid", params: { gid: group.id } });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setNameError("Give the group a name.");
    if (name.trim().length > 100) return setNameError("Use at most 100 characters.");
    setNameError(undefined);
    create.mutate();
  }

  return (
    <>
      <PageHeader
        title="New group"
        back={
          <Link to="/" className="text-sm underline underline-offset-4">
            Back to your groups
          </Link>
        }
      />
      <Card as="section">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextField
            label="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            placeholder="Goa trip"
            maxLength={120}
            required
          />
          <SelectField
            label="Currency"
            value={chosenCurrency}
            onChange={(e) => setCurrency(e.target.value)}
            hint="Every expense in the group uses it. It cannot be changed later."
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Emoji (optional)"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            maxLength={16}
            placeholder="🌴"
          />
          <CheckboxField
            label="Simplify debts"
            hint="Suggest the fewest payments that settle everyone, even if that means paying someone who did not pay you. You can change it later."
            checked={simplify}
            onChange={(e) => setSimplify(e.target.checked)}
          />
          {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
          <Button type="submit" loading={create.isPending}>
            Create group
          </Button>
        </form>
      </Card>
    </>
  );
}
