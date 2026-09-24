import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldCheck, Clock, Activity, Settings, X, Save } from 'lucide-react';

export default function WorkloadControl({ token, userRole }) {
  const [workloads, setWorkloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // حالات نافذة تعديل الـ SLA
  const [showSlaModal, setShowSlaModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [slaForm, setSlaForm] = useState({ SLATargetMinutes: 60, AvgItemProcessingSeconds: 30 });
  const [isSaving, setIsSaving] = useState(false);

  const fetchWorkloads = () => {
    fetch('http://127.0.0.1:8000/api/sla-workload', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      setWorkloads(data);
      setLoading(false);
    })
    .catch(err => {
      setError(err.message);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchWorkloads();
    const interval = setInterval(fetchWorkloads, 5000); // تحديث كل 5 ثوانٍ لمحاكاة البث الحي
    return () => clearInterval(interval);
  }, [token]);

  const openEditModal = (workload) => {
    setEditingProcess(workload.ProcessName);
    setSlaForm({
      SLATargetMinutes: workload.SLATargetMinutes || 60,
      AvgItemProcessingSeconds: workload.AvgItemProcessingSeconds || 30
    });
    setShowSlaModal(true);
  };

  const handleSaveSLA = () => {
    setIsSaving(true);
    fetch('http://127.0.0.1:8000/api/update-sla', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ProcessName: editingProcess,
        ...slaForm
      })
    })
    .then(res => res.json())
    .then(resData => {
      setIsSaving(false);
      if (resData.status === "success") {
        setShowSlaModal(false);
        fetchWorkloads();
      } else {
        alert(resData.message || "عفواً، حدث خطأ أثناء الحفظ");
      }
    })
    .catch(err => {
      console.error(err);
      setIsSaving(false);
    });
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-12 h-12 border-4 border-[#F37920] border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="p-10 xl:p-12 animate-in fade-in duration-500 h-full overflow-y-auto w-full bg-slate-50/50">
      <div className="mb-10 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-[#4B367C] tracking-tight flex items-center gap-3">
            <Activity size={36} className="text-red-500" />
            SLA & Workload Control
          </h2>
          <p className="text-sm text-slate-500 font-bold tracking-wide mt-2">
            Real-time queue monitoring and predictive breach alerts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {workloads.map((queue, idx) => {
          const isBreach = queue.SLAStatus === 'Breach_Risk';
          const isWarning = queue.SLAStatus === 'Warning';
          const isHealthy = queue.SLAStatus === 'Healthy';

          return (
            <div key={idx} className={`relative bg-white p-6 rounded-[2rem] border-2 shadow-sm transition-all duration-300 ${
              isBreach ? 'border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 
              isWarning ? 'border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.15)]' : 
              'border-slate-200 hover:border-[#10B981]'
            }`}>

              {/* مؤشر الخطر الوامض */}
              {isBreach && (
                <div className="absolute -top-3 -right-3">
                  <span className="flex h-8 w-8 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-8 w-8 bg-red-500 items-center justify-center text-white"><AlertTriangle size={16}/></span>
                  </span>
                </div>
              )}

              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-black text-slate-800 text-lg truncate pr-4">{queue.ProcessName.replace('_', ' ')}</h3>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{queue.Department} Department</span>
                </div>
                {(userRole === 'SuperAdmin' || userRole === 'CoE_Manager') && (
                  <button onClick={() => openEditModal(queue)} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors text-slate-400 hover:text-[#4B367C]">
                    <Settings size={18} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Pending In Queue</p>
                  <p className={`text-3xl font-black ${queue.PendingItems > 0 ? 'text-[#4B367C]' : 'text-slate-300'}`}>{queue.PendingItems}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Active Now</p>
                  <p className="text-3xl font-black text-[#F37920]">{queue.ActiveItems}</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-slate-500 flex items-center gap-2"><Clock size={14}/> Est. Completion</span>
                  <span className={`font-black ${isBreach ? 'text-red-500' : 'text-slate-800'}`}>{queue.EstimatedCompletionMinutes} min</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className={`h-2 rounded-full transition-all duration-1000 ${isBreach ? 'bg-red-500 w-full' : isWarning ? 'bg-amber-400 w-3/4' : 'bg-[#10B981] w-1/4'}`}></div>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-400">Target SLA: {queue.SLATargetMinutes}m</span>
                  <span className={`font-black uppercase tracking-wider ${isBreach ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-[#10B981]'}`}>
                    {isBreach ? 'BREACH RISK' : isWarning ? 'WARNING' : 'HEALTHY'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* نافذة تعديل الـ SLA المخصصة */}
      {showSlaModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white rounded-t-[2rem]">
              <div>
                <h3 className="text-xl font-black text-slate-900">Configure SLA</h3>
                <p className="text-xs text-[#F37920] font-bold mt-1">{editingProcess.replace('_', ' ')}</p>
              </div>
              <button onClick={() => setShowSlaModal(false)} className="text-slate-400 hover:text-red-500 p-2 bg-white rounded-full shadow-sm border border-slate-200">
                <X size={18} strokeWidth={2.5}/>
              </button>
            </div>
            <div className="p-6 bg-slate-50 space-y-4 rounded-b-[2rem]">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Target SLA (Minutes)</label>
                <input type="number" value={slaForm.SLATargetMinutes} onChange={(e) => setSlaForm({...slaForm, SLATargetMinutes: parseInt(e.target.value)})} className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C]" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Avg Processing Time (Seconds)</label>
                <input type="number" value={slaForm.AvgItemProcessingSeconds} onChange={(e) => setSlaForm({...slaForm, AvgItemProcessingSeconds: parseInt(e.target.value)})} className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C]" />
              </div>
              <button onClick={handleSaveSLA} disabled={isSaving} className="w-full mt-4 bg-gradient-to-r from-red-500 to-red-600 text-white font-black py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex justify-center items-center gap-2">
                {isSaving ? <Activity size={20} className="animate-spin" /> : <Save size={20} />}
                {isSaving ? "Saving..." : "Apply Strict SLA"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}