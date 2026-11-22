"use client";

import { useState } from "react";
import { DATA_ENTRY_DOMAINS } from "@/lib/domains/registry";

interface AccountRow {
  user_id: string;
  role: "super_admin" | "data_entry";
  domain_scope: string[];
  active: boolean;
  created_at: string;
}

/**
 * Super-admin-only panel: invite a new scoped data-entry account, and
 * activate/deactivate existing ones. Every action here hits
 * /api/admin/accounts[/[userId]], which re-checks the caller's role,
 * validates the body, and writes an audit_log row — this component does
 * no authorization itself, it only calls the API and reflects the result.
 */
export function AdminAccountsPanel({ initialAccounts }: { initialAccounts: AccountRow[] }) {
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [email, setEmail] = useState("");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/accounts");
    if (res.ok) {
      const body = await res.json();
      setAccounts(body.accounts ?? []);
    }
  }

  function toggleDomain(domain: string) {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, domainScope: selectedDomains }),
    });
    const body = await res.json();

    if (!res.ok) {
      setMessage({ kind: "error", text: body.error ?? "Failed to create account" });
    } else {
      setMessage({ kind: "ok", text: `Invited ${body.email}.` });
      setEmail("");
      setSelectedDomains([]);
      await refresh();
    }
    setSubmitting(false);
  }

  async function handleToggleActive(userId: string, nextActive: boolean) {
    const res = await fetch(`/api/admin/accounts/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    if (res.ok) await refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm"
      >
        <h2 className="text-base font-semibold text-brand-teal-dark">
          Invite a data-entry account
        </h2>

        {message && (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-sm ${
              message.kind === "ok"
                ? "bg-brand-mint-pale text-brand-ink"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </p>
        )}

        <label className="mt-4 block text-sm font-medium text-brand-ink-soft" htmlFor="new-email">
          Email
        </label>
        <input
          id="new-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
        />

        <p className="mt-4 text-sm font-medium text-brand-ink-soft">Data domain(s)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DATA_ENTRY_DOMAINS.map((domain) => (
            <label
              key={domain}
              className="flex items-center gap-2 rounded-md border border-brand-grey-green px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={selectedDomains.includes(domain)}
                onChange={() => toggleDomain(domain)}
              />
              {domain.replace(/_/g, " ")}
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={submitting || selectedDomains.length === 0}
          className="mt-4 rounded-md bg-brand-teal px-4 py-2 text-sm font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {submitting ? "Inviting…" : "Send invite"}
        </button>
      </form>

      <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-brand-teal-dark">All accounts</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-grey-green text-brand-muted">
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Domain scope</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.user_id} className="border-b border-brand-grey-green/60">
                <td className="py-2 pr-4">{account.role}</td>
                <td className="py-2 pr-4">
                  {account.domain_scope.join(", ") || "—"}
                </td>
                <td className="py-2 pr-4">{account.active ? "Active" : "Deactivated"}</td>
                <td className="py-2">
                  {account.role === "data_entry" && (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(account.user_id, !account.active)}
                      className="rounded-md border border-brand-grey-green px-2 py-1 text-xs font-medium hover:bg-brand-teal-soft"
                    >
                      {account.active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
