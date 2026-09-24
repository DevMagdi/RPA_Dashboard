import React, { useState, useEffect } from 'react';
import { ShieldCheck, History, ArrowRight, User, Clock, AlertCircle } from 'lucide-react';

export default function AuditTrails({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/audit-logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error("ليس لديك صلاحية لعرض هذه البيانات");
        return res.json();
      })
      .then(data => {
        setLogs(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  // دالة ذكية لتحويل النصوص المحفوظة في الداتابيز إلى كائنات مقارنة
  const parseChanges = (oldStr, newStr) => {
    try {
      // تحويل النص المحفوظ بصيغة البايثون إلى JSON صالح
      const formatStr = (str) => str === "None" ? "{}" : str.replace(/'/g, '"');
      const oldObj = JSON.parse(formatStr(oldStr));
      const newObj = JSON.parse(formatStr(newStr));

      return Object.keys(newObj).map(key => ({
        key,
        oldVal: oldObj[key] !== undefined ? oldObj[key] : '-',
        newVal: newObj[key],
        isChanged: oldObj[key] !== newObj[key]
      })).filter(item => item.isChanged);
    } catch (e) {
      return [];
    }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-12 h-12 border-4 border-[#4B367C] border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (error) return (
    <div className="flex flex-col h-full items-center justify-center text-red-500">
      <AlertCircle size={48} className="mb-4" />
      <h2 className="text-xl font-bold">Access Denied</h2>
      <p>{error}</p>
    </div>
  );

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
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Process Name</th>
                <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Modifications (Old <ArrowRight size={12} className="inline" /> New)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map((log) => (
                <tr key={log.LogID} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-8 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                      <Clock size={14} className="text-slate-400" />
                      {log.ActionDate}
                    </div>
                  </td>
                  <td className="px-8 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm font-black text-[#4B367C]">
                      <div className="bg-[#4B367C]/10 p-1.5 rounded-md"><User size={14} /></div>
                      {log.Username}
                    </div>
                  </td>
                  <td className="px-8 py-4">
                    <span className="text-sm font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                      {log.ProcessName.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-8 py-4">
                    <div className="space-y-2">
                      {parseChanges(log.OldValues, log.NewValues).map((change, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs font-mono bg-slate-50 p-2 rounded-lg border border-slate-100 w-fit">
                          <span className="font-bold text-slate-500">{change.key}:</span>
                          <span className="text-red-500 line-through decoration-red-300">{change.oldVal}</span>
                          <ArrowRight size={12} className="text-slate-400" />
                          <span className="text-emerald-600 font-black bg-emerald-50 px-1.5 rounded">{change.newVal}</span>
                        </div>
                      ))}
                      {parseChanges(log.OldValues, log.NewValues).length === 0 && (
                        <span className="text-xs font-bold text-slate-400 italic">No exact parameter changes detected / Initial Creation</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
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