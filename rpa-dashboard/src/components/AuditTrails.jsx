import React, { useEffect, useState } from 'react';
import { ShieldCheck, History, ArrowRight, User, Clock, AlertCircle } from 'lucide-react';

const API_BASE = 'http://127.0.0.1:8000';

export default function AuditTrails({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // -------- Helpers --------
  const safeParseJsonLike = (val) => {
    // returns object
    if (val === null || val === undefined) return {};
    if (typeof val === 'object') return val; // already parsed
    const raw = String(val).trim();
    if (!raw || raw.toLowerCase() === 'none' || raw === 'null') return {};

    // 1) direct JSON
    try {
      const o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (_) {}

    // 2) try to normalize python-ish strings (legacy)
    try {
      let s = raw;

      // python literals -> JSON literals
      s = s.replace(/\bNone\b/g, 'null');
      s = s.replace(/\bTrue\b/g, 'true');
      s = s.replace(/\bFalse\b/g, 'false');

      // naive single quote -> double quote (best-effort)
      // (works for simple dicts saved as "{'a': 1}")
      s = s.replace(/'/g, '"');

      const o2 = JSON.parse(s);
      return (o2 && typeof o2 === 'object') ? o2 : {};
    } catch (_) {
      return {};
    }
  };

  const formatVal = (v) => {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}...` : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      const s = JSON.stringify(v);
      return s.length > 120 ? `${s.slice(0, 120)}...` : s;
    } catch {
      return String(v);
    }
  };

  // returns array of diffs; if create event, returns "all keys as changed" (old '-')
  const parseChanges = (oldVal, newVal) => {
    const oldObj = safeParseJsonLike(oldVal);
    const newObj = safeParseJsonLike(newVal);

    const newKeys = Object.keys(newObj || {});
    if (newKeys.length === 0) return [];

    const diffs = newKeys.map((key) => {
      const o = oldObj?.[key];
      const n = newObj?.[key];
      const isChanged = JSON.stringify(o) !== JSON.stringify(n);
      return {
        key,
        oldVal: (o === undefined ? '-' : formatVal(o)),
        newVal: formatVal(n),
        isChanged,
      };
    }).filter(x => x.isChanged);

    // لو old فاضي و new فيه بيانات => Creation / initial
    if (diffs.length === 0 && Object.keys(oldObj || {}).length === 0) {
      return newKeys.map((key) => ({
        key,
        oldVal: '-',
        newVal: formatVal(newObj[key]),
        isChanged: true,
      }));
    }

    return diffs;
  };

  // -------- Fetch --------
  useEffect(() => {
    if (!token) return;

    const ac = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          // FastAPI returns {detail: "..."}
          throw new Error(body?.detail || 'ليس لديك صلاحية لعرض هذه البيانات');
        }
        return body;
      })
      .then((data) => {
        if (Array.isArray(data)) setLogs(data);
        else setLogs([]);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message || 'حدث خطأ أثناء تحميل السجلات');
        setLoading(false);
      });

    return () => ac.abort();
  }, [token]);

  // -------- UI states --------
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#4B367C] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-red-500">
        <AlertCircle size={48} className="mb-4" />
        <h2 className="text-xl font-bold">Access Denied</h2>
        <p className="text-center max-w-xl">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-10 xl:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto w-full">
      <div className="mb-10">
        <h2 className="text-4xl font-black text-[#4B367C] tracking-tight flex items-center gap-3">
          <ShieldCheck size={36} className="text-[#F37920]" />
          Governance & Audit Trails
        </h2>
        <p className="text-sm text-slate-500 font-bold tracking-wide mt-2">
          Enterprise security log monitoring system. All configuration changes are strictly tracked.
        </p>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
            <History size={18} /> Configuration Change Logs
          </h3>
          <span className="bg-[#4B367C]/10 text-[#4B367C] px-3 py-1 rounded-full text-xs font-bold">
            {logs.length} Records Found
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-100">
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Timestamp</th>
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">User</th>
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Action / Process</th>
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">
                  Modifications (Old <ArrowRight size={12} className="inline" /> New)
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {logs.map((log, idx) => {
                const changes = parseChanges(log?.OldValues, log?.NewValues);

                const actionType = log?.ActionType || 'Unknown_Action';
                const processName = (log?.ProcessName ?? null);
                const processLabel = processName ? String(processName).replace(/_/g, ' ') : 'غير محدد';
                const username = log?.Username || 'System';

                return (
                  <tr key={log?.LogID ?? idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-8 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                        <Clock size={14} className="text-slate-400" />
                        {log?.ActionDate || '-'}
                      </div>
                    </td>

                    <td className="px-8 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm font-black text-[#4B367C]">
                        <div className="bg-[#4B367C]/10 p-1.5 rounded-md">
                          <User size={14} />
                        </div>
                        {username}
                      </div>
                    </td>

                    <td className="px-8 py-4">
                      <div className="flex flex-col gap-2">
                        <span className="text-[11px] font-black text-slate-600 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 w-fit">
                          {actionType}
                        </span>
                        <span className="text-sm font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 w-fit">
                          {processLabel}
                        </span>
                      </div>
                    </td>

                    <td className="px-8 py-4">
                      <div className="space-y-2">
                        {changes.map((change, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 text-xs font-mono bg-slate-50 p-2 rounded-lg border border-slate-100 w-fit"
                          >
                            <span className="font-bold text-slate-500">{change.key}:</span>
                            <span className="text-red-500 line-through decoration-red-300">{change.oldVal}</span>
                            <ArrowRight size={12} className="text-slate-400" />
                            <span className="text-emerald-600 font-black bg-emerald-50 px-1.5 rounded">
                              {change.newVal}
                            </span>
                          </div>
                        ))}

                        {changes.length === 0 && (
                          <span className="text-xs font-bold text-slate-400 italic">
                            No diff detected (or non-JSON payload) / Initial Event
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {logs.length === 0 && (
                <tr>
                  <td colSpan="4" className="px-8 py-12 text-center text-slate-400 font-bold">
                    No audit logs available at this time.
                  </td>
                </tr>
              )}
            </tbody>

          </table>
        </div>
      </div>
    </div>
  );
}