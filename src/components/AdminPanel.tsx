import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ShieldCheck, X } from 'lucide-react';
import type { UserProfile, UserRole } from '../types/user.ts';
import { apiFetch } from '../utils/api.ts';

/** Minimal internal view for manual role assignment. Admin role only. */
export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<Record<string, UserRole>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ profiles: UserProfile[] }>('/api/admin/users');
      setProfiles(data.profiles);
      setRoles(Object.fromEntries(data.profiles.map((p) => [p.userId, p.role])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent, userId: string) => {
    event.preventDefault();
    const role = roles[userId];
    const reason = (reasons[userId] || '').trim();
    if (reason.length < 5) {
      setError('Add a short audit reason before changing a role.');
      return;
    }
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role, reason }),
      });
      setMessage('Role updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that role.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            User roles
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Roles are stored server-side. Every change is written to the audit log
            with the reason you provide.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close admin panel"
          className="text-slate-400 hover:text-slate-700 cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {message && <p className="mt-4 text-xs text-emerald-700">{message}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Audit reason</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles.map((item) => (
              <tr key={item.userId}>
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-slate-800">
                    {item.displayName || item.userId}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Joined {item.createdAt ? item.createdAt.slice(0, 10) : '—'}
                  </div>
                </td>
                <td className="py-2.5 pr-4">
                  <select
                    value={roles[item.userId] || 'free'}
                    onChange={(event) =>
                      setRoles((prev) => ({
                        ...prev,
                        [item.userId]: event.target.value as UserRole,
                      }))
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="py-2.5 pr-4">
                  <input
                    value={reasons[item.userId] || ''}
                    onChange={(event) =>
                      setReasons((prev) => ({
                        ...prev,
                        [item.userId]: event.target.value,
                      }))
                    }
                    placeholder="e.g. Paid Pro subscription"
                    className="w-full min-w-[180px] rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </td>
                <td className="py-2.5">
                  <button
                    type="button"
                    disabled={busyId === item.userId}
                    onClick={(event) => void save(event, item.userId)}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {profiles.length === 0 && (
          <p className="py-4 text-center text-xs text-slate-500">No users yet.</p>
        )}
      </div>
    </section>
  );
}
