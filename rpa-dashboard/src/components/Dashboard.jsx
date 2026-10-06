import React, { useState, useEffect, useMemo, useRef } from 'react';
import AuditTrails from './AuditTrails';
import WorkloadControl from './WorkloadControl';
import InfrastructureHealth from './InfrastructureHealth';
import {
  LayoutDashboard, Activity, CheckCircle2, Clock, TrendingUp, AlertCircle,
  X, Zap, ChevronRight, ChevronDown, Folder, Settings, ShieldAlert, Cpu,
  SlidersHorizontal, Save, Users, Download, Calendar, LogOut, Search,
  ShieldCheck, ListTodo, Server, GitBranch, KeyRound, Plus, ArrowUpRight,
  Shield, Check, RefreshCw, Lock, Sparkles, Terminal, FileCode2, RotateCcw,
  Eye, EyeOff, Calculator, MessageSquare, ArrowRight, CornerDownLeft, Layers
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';

// ==========================================
// محرك الـ Virtualization الخاص بنا
// + يدعم Infinite Scroll (End reached)
// ==========================================
const VirtualTreeList = ({
  itemCount,
  itemSize,
  height,
  onEndReached,
  children: renderItem
}) => {
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - 2);
  const endIndex = Math.min(itemCount - 1, startIndex + Math.ceil(height / itemSize) + 6);

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push(
      renderItem(i, {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: itemSize,
        transform: `translateY(${i * itemSize}px)`
      })
    );
  }

  const handleScroll = (e) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);

    const remaining = e.currentTarget.scrollHeight - (st + e.currentTarget.clientHeight);
    if (remaining < itemSize * 8) {
      onEndReached?.();
    }
  };

  return (
    <div
      className="custom-scrollbar"
      style={{ height, overflowY: 'auto', position: 'relative' }}
      onScroll={handleScroll}
    >
      <div style={{ height: itemCount * itemSize, position: 'relative', width: '100%' }}>
        {items}
      </div>
    </div>
  );
};
// ==========================================

const API_BASE = 'http://127.0.0.1:8000';

const safeNumber = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return '';
  const num = parseFloat(value);
  return isNaN(num) ? fallback : num;
};

const dateFilterToDays = (dateFilter) => {
  switch (dateFilter) {
    case 'today': return 1;
    case '7days': return 7;
    case 'this_month': return 30;
    case 'all_time':
    default:
      return 730;
  }
};

const statusPillClass = (status) => {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-600 border border-emerald-100';
  if (status === 'Running') return 'bg-[#F37920]/10 text-[#F37920] border border-[#F37920]/30';
  if (status === 'Failed' || status === 'Stopped') return 'bg-red-50 text-red-600 border border-red-200 cursor-pointer hover:bg-red-100 hover:scale-[1.02] shadow-sm';
  return 'bg-slate-50 text-slate-600 border border-slate-200';
};

const getEnvBadge = (env) => {
  switch (env) {
    case 'Production':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shadow-sm">
          <Shield size={12} className="text-emerald-600" />
          Production
        </span>
      );
    case 'UAT':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase bg-[#F37920]/10 text-[#F37920] border border-[#F37920]/20 shadow-sm">
          <Activity size={12} className="text-[#F37920]" />
          UAT Staging
        </span>
      );
    case 'Development':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase bg-blue-50 text-blue-600 border border-blue-200 shadow-sm">
          <FileCode2 size={12} className="text-blue-500" />
          Development
        </span>
      );
  }
};

// ============================================================
// Bot Lifecycle & Vault View Component
// ============================================================
function BotLifecycleView({ token, userRole, initialProcess, processConfigs, onSyncRequested }) {
  const [selectedProcess, setSelectedProcess] = useState(
    initialProcess && initialProcess !== 'All' ? initialProcess : (processConfigs[0]?.ProcessName || '')
  );
  const [liveData, setLiveData] = useState({ counts: {}, recent_promotions: [] });
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [selectedVersionForAction, setSelectedVersionForAction] = useState(null);
  const [showSecretValue, setShowSecretValue] = useState(false);

  // Modal Mode: "new_process" أو "new_version"
  const [creationMode, setCreationMode] = useState("new_process");

  // Forms
  const [createForm, setCreateForm] = useState({
    ProcessName: '',
    Department: 'Operations',
    BotName: '',
    VersionTag: 'v1.0.0',
    TargetMachineName: '',
    Description: '',
    ExpectedRunsPerDay: 50,
    EmpMinutesPerRequest: 15,
    EmpCostPerRequest: 25.0,
    BotCostPerRequest: 2.0
  });

  const [transitionForm, setTransitionForm] = useState({
    TargetEnvironment: 'UAT',
    Comment: ''
  });

  const [vaultForm, setVaultForm] = useState({
    CredentialName: '',
    Environment: 'Production',
    Value: ''
  });

  const isCoEOrAdmin = userRole === 'SuperAdmin' || userRole === 'CoE_Manager';

  const triggerToast = (msg, isError = false) => {
    setToastMessage({ text: msg, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchLiveStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/bot-versions/live-status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        setLiveData(d);
      }
    } catch (e) {
      console.error("Failed to load lifecycle live status:", e);
    }
  };

  const fetchHistory = async (procName) => {
    if (!procName) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-versions/${encodeURIComponent(procName)}/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const list = await res.json();
        setVersions(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.error("Failed to load version history:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveStatus();
  }, [token]);

  useEffect(() => {
    if (selectedProcess) {
      fetchHistory(selectedProcess);
    }
  }, [selectedProcess, token]);

  useEffect(() => {
    if (initialProcess && initialProcess !== 'All') {
      setSelectedProcess(initialProcess);
    }
  }, [initialProcess]);

  const handleCreateVersion = async (e) => {
    e.preventDefault();
    setActionLoading(true);

    const targetProc = creationMode === "new_process"
      ? createForm.ProcessName.trim().replace(/\s+/g, '_')
      : selectedProcess;

    if (!targetProc) {
      triggerToast("يرجى تحديد أو إدخال اسم العملية", true);
      setActionLoading(false);
      return;
    }

    try {
      const roiPayload = {
        ProcessName: targetProc,
        EmpMinutesPerRequest: parseFloat(createForm.EmpMinutesPerRequest) || 15,
        EmpCostPerRequest: parseFloat(createForm.EmpCostPerRequest) || 25,
        BotCostPerRequest: parseFloat(createForm.BotCostPerRequest) || 2,
        ExpectedRunsPerDay: parseInt(createForm.ExpectedRunsPerDay) || 50
      };

      await fetch(`${API_BASE}/api/update-roi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(roiPayload)
      });

      const res = await fetch(`${API_BASE}/api/bot-versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ProcessName: targetProc,
          VersionTag: createForm.VersionTag || 'v1.0.0',
          TargetMachineName: createForm.TargetMachineName || null,
          Description: createForm.Description || (creationMode === "new_process" ? "Initial system build" : null)
        })
      });

      const resData = await res.json();
      if (!res.ok || resData.status !== 'success') {
        throw new Error(resData.detail || resData.message || "فشل تسجيل النسخة");
      }

      setShowCreateModal(false);
      triggerToast(`تم بنجاح حفظ العملية [${targetProc}] وإصدار نسختها الأولى وتحديث معايير الـ ROI`);

      setSelectedProcess(targetProc);
      await fetchHistory(targetProc);
      await fetchLiveStatus();
      if (onSyncRequested) onSyncRequested();

    } catch (err) {
      triggerToast(err.message || "حدث خطأ أثناء الاتصال بالسيرفر", true);
    } finally {
      setActionLoading(false);
    }
  };

  const openTransitionModal = (version) => {
    setSelectedVersionForAction(version);
    const nextEnv = version.CurrentStatus === 'Development' ? 'UAT' : (version.CurrentStatus === 'UAT' ? 'Production' : 'Development');
    setTransitionForm({
      TargetEnvironment: nextEnv,
      Comment: ''
    });
    setShowTransitionModal(true);
  };

  const handleExecuteTransition = async (e) => {
    e.preventDefault();
    if (!selectedVersionForAction) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/bot-versions/${selectedVersionForAction.VersionID}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          TargetEnvironment: transitionForm.TargetEnvironment,
          Comment: transitionForm.Comment || 'Status updated via Control Hub'
        })
      });

      const resData = await res.json();
      if (res.ok && resData.status === 'success') {
        setShowTransitionModal(false);
        triggerToast(`تم تحويل النسخة بنجاح إلى بيئة [${transitionForm.TargetEnvironment}]`);
        await fetchHistory(selectedProcess);
        await fetchLiveStatus();
        if (onSyncRequested) onSyncRequested();
      } else {
        triggerToast(resData.detail || resData.message || "تعذر تغيير حالة النسخة", true);
      }
    } catch (err) {
      triggerToast("خطأ بالاتصال أثناء تحديث بيئة النسخة", true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddVaultCredential = async (e) => {
    e.preventDefault();
    if (!selectedVersionForAction) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/bot-versions/${selectedVersionForAction.VersionID}/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(vaultForm)
      });

      const resData = await res.json();
      if (res.ok && resData.status === 'success') {
        setShowVaultModal(false);
        setVaultForm({ CredentialName: '', Environment: 'Production', Value: '' });
        await fetchHistory(selectedProcess);
        triggerToast("تم تشفير السر وتخزينه في الخزنة BotVault بنجاح!");
      } else {
        triggerToast(resData.detail || resData.message || "تعذر حفظ السر", true);
      }
    } catch (err) {
      triggerToast("خطأ أثناء تشفير وحفظ البيانات", true);
    } finally {
      setActionLoading(false);
    }
  };

  const forecastedDailySavings = useMemo(() => {
    const runs = Number(createForm.ExpectedRunsPerDay) || 0;
    const netSavingsPerRequest = (Number(createForm.EmpCostPerRequest) || 0) - (Number(createForm.BotCostPerRequest) || 0);
    return Math.max(0, runs * netSavingsPerRequest);
  }, [createForm]);

  const forecastedMonthlyHours = useMemo(() => {
    const runs = Number(createForm.ExpectedRunsPerDay) || 0;
    const minutes = Number(createForm.EmpMinutesPerRequest) || 0;
    return Math.round(((runs * minutes) / 60) * 22);
  }, [createForm]);

  return (
    <div className="flex-1 overflow-y-auto p-10 xl:p-12 space-y-8 animate-in fade-in duration-300 relative">

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-sm font-black transition-all animate-in slide-in-from-bottom-5 duration-300 ${
          toastMessage.isError ? 'bg-red-600 text-white shadow-red-500/20' : 'bg-[#4B367C] text-white shadow-[#4B367C]/30 border border-white/20'
        }`}>
          {toastMessage.isError ? <ShieldAlert size={20} /> : <CheckCircle2 size={20} className="text-emerald-400" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-[#4B367C] tracking-tight flex items-center gap-3">
            <GitBranch className="text-[#F37920]" size={34} />
            Enterprise Bot Lifecycle & Vault Hub
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">
            إدارة دورة حياة البوتات، العزل الأمني بين البيئات (Dev, UAT, Prod) وتشفير بيانات الخزنة
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchLiveStatus(); fetchHistory(selectedProcess); if (onSyncRequested) onSyncRequested(); }}
            className="p-3.5 bg-white border border-slate-200 hover:border-[#4B367C] rounded-2xl text-slate-600 shadow-sm transition-all hover:bg-slate-50"
            title="تحديث ومزامنة البيانات الحية"
          >
            <RefreshCw size={18} className={actionLoading ? "animate-spin text-[#4B367C]" : ""} />
          </button>

          {isCoEOrAdmin && (
            <button
              onClick={() => {
                setCreationMode("new_process");
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#4B367C] via-[#5c4096] to-[#F37920] text-white shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all font-black text-xs uppercase tracking-wider"
            >
              <Plus size={18} /> New Process / Release & ROI
            </button>
          )}
        </div>
      </div>

      {/* Live Pipeline Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-7 rounded-[2.2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="bg-blue-50 text-blue-600 p-3.5 rounded-2xl">
              <FileCode2 size={24} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-blue-100/60 text-blue-700 rounded-lg">Sandbox Stage</span>
          </div>
          <h3 className="text-5xl font-black text-slate-800">{liveData.counts?.DevCount ?? 0}</h3>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-1">Development Builds</p>
          <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
            Internal Engineering & Sandbox
          </div>
        </div>

        <div className="bg-white p-7 rounded-[2.2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-[#F37920]/40 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="bg-[#F37920]/10 text-[#F37920] p-3.5 rounded-2xl">
              <Activity size={24} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-[#F37920]/10 text-[#F37920] rounded-lg">Verification Stage</span>
          </div>
          <h3 className="text-5xl font-black text-slate-800">{liveData.counts?.UATCount ?? 0}</h3>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-1">UAT / Pre-Flight Staging</p>
          <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F37920]"></span>
            Pre-flight User Acceptance & Testing
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#4B367C] via-[#3d2b63] to-[#251940] text-white p-7 rounded-[2.2rem] shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-bl-full blur-2xl pointer-events-none"></div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="bg-white/10 text-emerald-400 p-3.5 rounded-2xl backdrop-blur-md border border-white/10">
              <Shield size={24} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg">Live Production</span>
          </div>
          <h3 className="text-5xl font-black text-white relative z-10">{liveData.counts?.ProductionCount ?? 0}</h3>
          <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mt-1 relative z-10">Production Certified</p>
          <div className="mt-4 pt-3.5 border-t border-white/10 flex items-center gap-2 text-xs text-emerald-300 font-bold relative z-10">
            <CheckCircle2 size={16} />
            Active Real-time Business Runners
          </div>
        </div>
      </div>

      {/* Main Release Track & Versions History */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-7 border-b border-slate-100 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-[#4B367C] uppercase tracking-wider flex items-center gap-2.5">
              <Terminal size={20} className="text-[#F37920]" />
              Release Track & Deployment Versions
            </h3>
            <p className="text-xs text-slate-500 font-bold mt-1">
              متابعة نسخ البوتات، تعديل البيئات، وتشفير مفاتيح الخزنة لكل مرحلة
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Active Process:</label>
            <select
              value={selectedProcess}
              onChange={(e) => setSelectedProcess(e.target.value)}
              className="bg-white border-2 border-slate-200 hover:border-[#4B367C] text-xs font-black text-slate-800 py-3 px-5 rounded-2xl focus:outline-none focus:border-[#4B367C] shadow-sm transition-colors cursor-pointer"
            >
              {processConfigs.map((p, i) => (
                <option key={i} value={p.ProcessName}>
                  {p.ProcessName.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table of Versions */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-wider">
                <th className="px-8 py-5">Release Tag</th>
                <th className="px-8 py-5">Active Stage</th>
                <th className="px-8 py-5">Assigned Runner</th>
                <th className="px-8 py-5">Vault Credentials</th>
                <th className="px-8 py-5">Release Owner</th>
                <th className="px-8 py-5 text-right">Stage Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {versions.map((ver) => (
                <tr key={ver.VersionID} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2.5 font-mono font-black text-sm text-[#4B367C]">
                      <span className="p-2 bg-[#4B367C]/10 text-[#4B367C] rounded-xl">
                        <GitBranch size={16} />
                      </span>
                      {ver.VersionTag}
                    </div>
                    {ver.Notes && (
                      <p className="text-xs text-slate-400 mt-1 max-w-sm truncate">{ver.Notes}</p>
                    )}
                  </td>

                  <td className="px-8 py-5">
                    {getEnvBadge(ver.CurrentStatus)}
                  </td>

                  <td className="px-8 py-5">
                    <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200/80">
                      {ver.TargetMachineName || 'Dynamic Pool'}
                    </span>
                  </td>

                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-black text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                        {ver.CredentialsCount || 0} Key(s)
                      </span>
                      {isCoEOrAdmin && (
                        <button
                          onClick={() => {
                            setSelectedVersionForAction(ver);
                            setShowVaultModal(true);
                          }}
                          className="p-2 text-slate-400 hover:text-[#4B367C] hover:bg-slate-100 rounded-xl transition-all"
                          title="إضافة وتشفير كلمة مرور في BotVault"
                        >
                          <KeyRound size={17} />
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="px-8 py-5">
                    <div className="text-xs font-black text-slate-700">{ver.CreatorName || 'Admin'}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {ver.CreatedAt ? new Date(ver.CreatedAt).toLocaleDateString() : '-'}
                    </div>
                  </td>

                  <td className="px-8 py-5 text-right">
                    {isCoEOrAdmin ? (
                      <button
                        onClick={() => openTransitionModal(ver)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-[#4B367C] text-white text-xs font-black shadow-md hover:shadow-lg transition-all"
                      >
                        <SlidersHorizontal size={14} /> Promote / Rollback
                      </button>
                    ) : (
                      <span className="text-xs font-bold text-slate-400">View Only</span>
                    )}
                  </td>
                </tr>
              ))}

              {versions.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-14 text-slate-400 font-bold text-sm bg-slate-50/30">
                    لا توجد نسخ مسجلة لهذه العملية حالياً. اضغط "New Process / Release & ROI" لتسجيل نسخة جديدة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promotion Audit Log */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200/80 shadow-sm p-7">
        <h3 className="text-sm font-black text-[#4B367C] uppercase tracking-wider mb-5 flex items-center gap-2.5">
          <ShieldCheck size={20} className="text-emerald-500" />
          Recent Stage Movements & Audit Trail
        </h3>

        <div className="divide-y divide-slate-100">
          {(liveData.recent_promotions || []).map((p, idx) => (
            <div key={idx} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="font-black text-slate-800">{p.ProcessName}</span>
                <span className="font-mono bg-slate-100 px-2.5 py-1 rounded-lg text-slate-700 font-bold">{p.VersionTag}</span>
                <span className="text-slate-400">moved from</span>
                <span className="font-bold text-slate-600">{p.PreviousStatus}</span>
                <span className="text-slate-400">➔</span>
                <span className="font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">{p.NewStatus}</span>
              </div>
              <div className="text-slate-400 font-medium">
                Authorized by <strong className="text-slate-700">{p.Username || 'System Admin'}</strong> at {new Date(p.PromotedAt).toLocaleString()}
              </div>
            </div>
          ))}

          {(liveData.recent_promotions || []).length === 0 && (
            <div className="py-6 text-center text-slate-400 font-bold text-xs">
              No promotions recorded yet.
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Sleek Modal: Create New Process OR Version + ROI Projection */}
      {/* ============================================================ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-2xl w-full flex flex-col border border-slate-100 overflow-hidden my-8 animate-in zoom-in-95 duration-200">

            {/* Header */}
            <div className="p-7 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-[#4B367C]/10 text-[#4B367C] rounded-2xl shadow-inner">
                  <GitBranch size={26} />
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900">
                    {creationMode === "new_process" ? "Register New Process & ROI Projection" : "New Release for Existing Process"}
                  </h4>
                  <p className="text-xs font-bold text-[#F37920] mt-0.5">
                    Enterprise CoE Control Room
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-red-500 p-2.5 bg-white hover:bg-red-50 rounded-full border border-slate-200 transition-all"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="p-7 pb-0">
              <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setCreationMode("new_process")}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all ${
                    creationMode === "new_process" ? "bg-white text-[#4B367C] shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Create Brand New Process (تسجيل عملية جديدة)
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode("new_version")}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all ${
                    creationMode === "new_version" ? "bg-white text-[#4B367C] shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  New Version for Existing Process (إصدار لعملية قائمة)
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateVersion} className="p-7 space-y-6">

              {/* Section 1: Process & Release Metadata */}
              <div className="space-y-4">
                <h5 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Terminal size={14} /> Process & Release Information
                </h5>

                {creationMode === "new_process" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">New Process Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Invoice_Reconciliation"
                        value={createForm.ProcessName}
                        onChange={(e) => setCreateForm({ ...createForm, ProcessName: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">Department</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Finance or Operations"
                        value={createForm.Department}
                        onChange={(e) => setCreateForm({ ...createForm, Department: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">Select Target Process</label>
                    <select
                      value={selectedProcess}
                      onChange={(e) => setSelectedProcess(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white cursor-pointer"
                    >
                      {processConfigs.map((p, i) => (
                        <option key={i} value={p.ProcessName}>{p.ProcessName.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">Version Tag</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. v1.0.0"
                      value={createForm.VersionTag}
                      onChange={(e) => setCreateForm({ ...createForm, VersionTag: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">Target Runner Machine (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. BOT-VM-01 (or empty)"
                      value={createForm.TargetMachineName}
                      onChange={(e) => setCreateForm({ ...createForm, TargetMachineName: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5 uppercase">Release Notes & Changes</label>
                  <textarea
                    rows={2}
                    value={createForm.Description}
                    onChange={(e) => setCreateForm({ ...createForm, Description: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                    placeholder="Brief description of bot logic, triggers or fixes in this build..."
                  />
                </div>
              </div>

              {/* Section 2: Expected ROI Parameters */}
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#F37920] flex items-center gap-2">
                  <Calculator size={14} /> Expected ROI Parameters (Live Forecast)
                </h5>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Target Runs / Day</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={createForm.ExpectedRunsPerDay}
                      onChange={(e) => setCreateForm({ ...createForm, ExpectedRunsPerDay: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold text-slate-800 text-xs focus:outline-none focus:border-[#4B367C]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Emp Time / Req (Min)</label>
                    <input
                      type="number"
                      required
                      step="0.1"
                      min={0}
                      value={createForm.EmpMinutesPerRequest}
                      onChange={(e) => setCreateForm({ ...createForm, EmpMinutesPerRequest: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold text-slate-800 text-xs focus:outline-none focus:border-[#4B367C]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Emp Cost / Req ($)</label>
                    <input
                      type="number"
                      required
                      step="0.1"
                      min={0}
                      value={createForm.EmpCostPerRequest}
                      onChange={(e) => setCreateForm({ ...createForm, EmpCostPerRequest: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold text-slate-800 text-xs focus:outline-none focus:border-[#4B367C]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Bot Cost / Req ($)</label>
                    <input
                      type="number"
                      required
                      step="0.1"
                      min={0}
                      value={createForm.BotCostPerRequest}
                      onChange={(e) => setCreateForm({ ...createForm, BotCostPerRequest: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold text-slate-800 text-xs focus:outline-none focus:border-[#4B367C]"
                    />
                  </div>
                </div>

                {/* Real-time ROI Projection Card */}
                <div className="bg-gradient-to-r from-[#4B367C]/10 via-[#F37920]/10 to-emerald-500/10 p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Forecasted Monthly Savings</span>
                    <p className="text-xl font-black text-slate-900">
                      $ {(forecastedDailySavings * 22).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black uppercase text-slate-400">Saved Time / Month</span>
                    <p className="text-xl font-black text-[#10B981]">
                      {forecastedMonthlyHours.toLocaleString()} hrs
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full mt-2 bg-gradient-to-r from-[#4B367C] via-[#5c4096] to-[#F37920] hover:opacity-95 text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {actionLoading ? <Activity size={18} className="animate-spin" /> : <Save size={18} />}
                {actionLoading ? "Registering & Publishing..." : "Publish Version (Init in Development)"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Sleek Modal: Change Stage (Promote / Rollback to ANY State) */}
      {/* ============================================================ */}
      {showTransitionModal && selectedVersionForAction && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-lg w-full flex flex-col border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">

            <div className="p-7 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-slate-900 text-white rounded-2xl">
                  <SlidersHorizontal size={24} />
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900">Stage Transition Control</h4>
                  <p className="text-xs font-bold text-slate-400 mt-0.5">
                    {selectedVersionForAction.VersionTag} ({selectedProcess.replace(/_/g, ' ')})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTransitionModal(false)}
                className="text-slate-400 hover:text-red-500 p-2.5 bg-white hover:bg-red-50 rounded-full border border-slate-200 transition-all"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            <form onSubmit={handleExecuteTransition} className="p-7 space-y-6">

              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-3">Choose Target Environment</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'Development', label: 'Dev Sandbox', icon: RotateCcw, color: 'blue' },
                    { id: 'UAT', label: 'UAT Staging', icon: Activity, color: 'orange' },
                    { id: 'Production', label: 'Live Prod', icon: Shield, color: 'emerald' },
                  ].map((env) => {
                    const isSelected = transitionForm.TargetEnvironment === env.id;
                    const IconComp = env.icon;
                    return (
                      <div
                        key={env.id}
                        onClick={() => setTransitionForm({ ...transitionForm, TargetEnvironment: env.id })}
                        className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col items-center text-center gap-2 ${
                          isSelected
                            ? 'border-[#4B367C] bg-[#4B367C]/5 shadow-sm scale-102'
                            : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 opacity-70'
                        }`}
                      >
                        <IconComp size={20} className={isSelected ? 'text-[#4B367C]' : 'text-slate-400'} />
                        <span className={`text-xs font-black ${isSelected ? 'text-[#4B367C]' : 'text-slate-600'}`}>{env.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Direction Indicator */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs font-black text-slate-700">
                <span className="flex items-center gap-1.5 text-slate-500">
                  Current: <strong className="text-slate-800">{selectedVersionForAction.CurrentStatus}</strong>
                </span>
                <ArrowRight size={16} className="text-[#F37920]" />
                <span className="flex items-center gap-1.5 text-emerald-600 font-black">
                  Target: <strong>{transitionForm.TargetEnvironment}</strong>
                </span>
              </div>

              {/* Justification Comment */}
              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-slate-400" />
                  Audit Comment / Reason for Transition
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Rolling back due to schema change / Promoting after successful UAT signoff..."
                  value={transitionForm.Comment}
                  onChange={(e) => setTransitionForm({ ...transitionForm, Comment: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-xs focus:outline-none focus:border-[#4B367C] focus:bg-white"
                />
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full bg-slate-900 hover:bg-[#4B367C] text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {actionLoading ? <Activity size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                {actionLoading ? "Processing Transition..." : `Authorize & Apply State Change`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Sleek Modal: Add Encrypted BotVault Secret */}
      {/* ============================================================ */}
      {showVaultModal && selectedVersionForAction && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-lg w-full flex flex-col border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">

            <div className="p-7 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-[#F37920]/10 text-[#F37920] rounded-2xl shadow-inner">
                  <Lock size={24} />
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900">Add Encrypted Vault Secret</h4>
                  <p className="text-xs font-bold text-slate-400 mt-0.5">
                    Version: {selectedVersionForAction.VersionTag} ({selectedProcess.replace(/_/g, ' ')})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowVaultModal(false)}
                className="text-slate-400 hover:text-red-500 p-2.5 bg-white hover:bg-red-50 rounded-full border border-slate-200 transition-all"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            <form onSubmit={handleAddVaultCredential} className="p-7 space-y-5">
              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2">Credential Key Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SAP_PROD_USER_PASS or ORACLE_DB_KEY"
                  value={vaultForm.CredentialName}
                  onChange={(e) => setVaultForm({ ...vaultForm, CredentialName: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2">Vault Stage Environment</label>
                <select
                  value={vaultForm.Environment}
                  onChange={(e) => setVaultForm({ ...vaultForm, Environment: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                >
                  <option value="Production">Production (Live Sensitive)</option>
                  <option value="UAT">UAT (Staging)</option>
                  <option value="Development">Development (Sandbox)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2">Secret Plaintext Value</label>
                <div className="relative">
                  <input
                    type={showSecretValue ? "text" : "password"}
                    required
                    placeholder="Enter password to encrypt..."
                    value={vaultForm.Value}
                    onChange={(e) => setVaultForm({ ...vaultForm, Value: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 p-3.5 pr-12 rounded-2xl font-mono text-slate-800 text-sm focus:outline-none focus:border-[#4B367C] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretValue(!showSecretValue)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {showSecretValue ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <span className="text-[11px] text-emerald-600 font-bold mt-2 flex items-center gap-1.5">
                  <Shield size={13} /> Hardware AES-256 Symmetric Fernet Encryption at rest
                </span>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full mt-2 bg-gradient-to-r from-[#F37920] to-[#e46a10] hover:opacity-95 text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {actionLoading ? <Activity size={18} className="animate-spin" /> : <Lock size={18} />}
                {actionLoading ? "Encrypting..." : "Encrypt & Store in BotVault"}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// ============================================================
// Main Dashboard Component
// ============================================================
export default function Dashboard({ token, userRole, userName, onLogout }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedProcess, setSelectedProcess] = useState("All");
  const [dateFilter, setDateFilter] = useState("all_time");
  const [isSwitching, setIsSwitching] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDepts, setExpandedDepts] = useState({});

  const [showExceptions, setShowExceptions] = useState(false);
  const [specificError, setSpecificError] = useState(null);

  const [showRoiModal, setShowRoiModal] = useState(false);
  const [roiSaving, setRoiSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // ROI form
  const [roiForm, setRoiForm] = useState({
    EmpMinutesPerRequest: 15,
    EmpCostPerRequest: 10,
    BotCostPerRequest: 0.5,
    ExpectedRunsPerDay: 50
  });

  // Enterprise processes
  const [processConfigs, setProcessConfigs] = useState([]);
  const [processCursor, setProcessCursor] = useState(null);
  const [isLoadingProcesses, setIsLoadingProcesses] = useState(false);
  const [hasMoreProcesses, setHasMoreProcesses] = useState(true);

  const processesReqId = useRef(0);
  const dashboardReqId = useRef(0);
  const searchDebounceRef = useRef(null);

  const PIE_COLORS = ['#4B367C', '#F37920', '#10B981', '#EF4444'];

  // Dashboard data
  const fetchData = (isAutoRefresh = false) => {
    if (!token) return;
    if (!isAutoRefresh) setIsSwitching(true);

    const days = dateFilterToDays(dateFilter);
    const reqId = ++dashboardReqId.current;

    fetch(`${API_BASE}/api/dashboard-data?process=${encodeURIComponent(selectedProcess)}&days=${days}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401) onLogout();
        return res.json();
      })
      .then(fetchedData => {
        if (reqId !== dashboardReqId.current) return;
        setData(fetchedData);
        setLoading(false);
        setIsSwitching(false);
      })
      .catch(err => {
        console.error("Error fetching data:", err);
        setLoading(false);
        setIsSwitching(false);
      });
  };

  // Keyset pagination processes
  const fetchProcessesPage = ({ reset = false } = {}) => {
    if (!token) return;
    if (isLoadingProcesses) return;
    if (!hasMoreProcesses && !reset) return;

    setIsLoadingProcesses(true);

    const reqId = ++processesReqId.current;
    const url = new URL(`${API_BASE}/api/processes`);
    url.searchParams.set('page_size', '200');
    if (searchQuery?.trim()) url.searchParams.set('search', searchQuery.trim());
    if (!reset && processCursor) url.searchParams.set('after', processCursor);

    fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(resData => {
        if (reqId !== processesReqId.current) return;

        const items = Array.isArray(resData?.items) ? resData.items : [];
        const next = resData?.next_cursor ?? null;

        setProcessCursor(next);
        setHasMoreProcesses(Boolean(next) && items.length > 0);

        setProcessConfigs(prev => reset ? items : [...prev, ...items]);
        setIsLoadingProcesses(false);
      })
      .catch(err => {
        console.error("Error fetching processes:", err);
        setIsLoadingProcesses(false);
      });
  };

  useEffect(() => {
    fetchData(false);
  }, [selectedProcess, dateFilter, token]);

  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 15000);
    return () => clearInterval(interval);
  }, [selectedProcess, dateFilter, token]);

  useEffect(() => {
    if (!token) return;

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setExpandedDepts({});
      setProcessConfigs([]);
      setProcessCursor(null);
      setHasMoreProcesses(true);
      fetchProcessesPage({ reset: true });
    }, 350);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, token]);

  useEffect(() => {
    if (!token) return;
    if (processConfigs.length === 0) {
      fetchProcessesPage({ reset: true });
    }
  }, [token]);

  // Tree nodes
  const processNodes = useMemo(() => {
    const filtered = processConfigs;
    const grouped = {};
    filtered.forEach(c => {
      const dept = c.Department || 'General';
      if (!grouped[dept]) grouped[dept] = [];
      grouped[dept].push(c.ProcessName);
    });

    const depts = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
    const flatList = [];
    depts.forEach(dept => {
      const procs = grouped[dept].sort((a, b) => a.localeCompare(b));
      flatList.push({ type: 'department', id: dept, name: dept, count: procs.length });

      if (expandedDepts[dept] || searchQuery) {
        procs.forEach(proc => {
          flatList.push({ type: 'process', id: proc, name: proc, dept: dept });
        });
      }
    });

    return flatList;
  }, [processConfigs, expandedDepts, searchQuery]);

  const toggleDept = (dept) => {
    setExpandedDepts(prev => ({ ...prev, [dept]: !prev[dept] }));
  };

  const openExceptionsModal = (errorData = null) => {
    setSpecificError(errorData);
    setShowExceptions(true);
  };

  const openRoiModal = async () => {
    let prefill = {
      EmpMinutesPerRequest: roiForm.EmpMinutesPerRequest ?? 0,
      EmpCostPerRequest: roiForm.EmpCostPerRequest ?? 0,
      BotCostPerRequest: roiForm.BotCostPerRequest ?? 0,
      ExpectedRunsPerDay: roiForm.ExpectedRunsPerDay ?? 0,
    };

    const cached = processConfigs.find(c => c.ProcessName === selectedProcess);
    if (cached) {
      prefill = {
        EmpMinutesPerRequest: cached.EmpMinutesPerRequest ?? prefill.EmpMinutesPerRequest,
        EmpCostPerRequest: cached.EmpCostPerRequest ?? prefill.EmpCostPerRequest,
        BotCostPerRequest: cached.BotCostPerRequest ?? prefill.BotCostPerRequest,
        ExpectedRunsPerDay: cached.ExpectedRunsPerDay ?? prefill.ExpectedRunsPerDay,
      };
    } else {
      try {
        const url = new URL(`${API_BASE}/api/processes`);
        url.searchParams.set('page_size', '50');
        url.searchParams.set('search', selectedProcess);
        const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${token}` } });
        const js = await res.json();
        const found = (js?.items || []).find(i => i.ProcessName === selectedProcess);
        if (found) {
          prefill = {
            EmpMinutesPerRequest: found.EmpMinutesPerRequest ?? prefill.EmpMinutesPerRequest,
            EmpCostPerRequest: found.EmpCostPerRequest ?? prefill.EmpCostPerRequest,
            BotCostPerRequest: found.BotCostPerRequest ?? prefill.BotCostPerRequest,
            ExpectedRunsPerDay: found.ExpectedRunsPerDay ?? prefill.ExpectedRunsPerDay,
          };
        }
      } catch (_) {}
    }

    setRoiForm(prefill);
    setShowRoiModal(true);
  };

  const handleSaveROI = () => {
  setRoiSaving(true);
  fetch(`${API_BASE}/api/update-roi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      ProcessName: selectedProcess,
      EmpMinutesPerRequest: Number(roiForm.EmpMinutesPerRequest) || 0,
      EmpCostPerRequest: Number(roiForm.EmpCostPerRequest) || 0,
      BotCostPerRequest: Number(roiForm.BotCostPerRequest) || 0,
      ExpectedRunsPerDay: Number(roiForm.ExpectedRunsPerDay) || 0,
    })
  })
      .then(res => res.json())
      .then(resData => {
        setRoiSaving(false);
        if (resData.status === "success") {
          setShowRoiModal(false);
          fetchData(false);
          fetchProcessesPage({ reset: true });
        } else {
          alert(resData.message || "عفواً، لا تملك صلاحية التعديل");
        }
      })
      .catch(err => {
        console.error(err);
        setRoiSaving(false);
      });
  };

  const formatCurrency = (amount) => {
    return Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#F8FAFC]">
      <div className="relative flex justify-center items-center mb-8">
        <div className="absolute animate-ping w-24 h-24 rounded-full bg-[#F37920] opacity-20"></div>
        <div className="w-16 h-16 border-4 border-[#4B367C] border-t-transparent rounded-full animate-spin relative z-10 shadow-lg"></div>
      </div>
      <p className="text-[#4B367C] font-black tracking-[0.2em] uppercase text-sm animate-pulse z-10">
        Syncing Enterprise CoE Workspace...
      </p>
    </div>
  );

  const safe = data || {};
  const kpis = safe.kpis || {};
  const stopsTodayAll = Number(kpis.stopsTodayAll ?? kpis.stopsToday ?? 0);
  const failureDetailsAll = Array.isArray(kpis.failureDetailsAll)
    ? kpis.failureDetailsAll
    : (Array.isArray(kpis.failureDetails) ? kpis.failureDetails : []);
  const sidebarStats = safe.sidebarStats || { successRate: 0, errorRate: 0, bookedRuns: 0 };
  const analytics = safe.analytics || {};
  const charts = safe.charts || { volume: [], savings: [] };
  const table = Array.isArray(safe.table) ? safe.table : [];
  const isRunning = kpis.status === 'Running';

  const selectProcessFromPortfolio = (proc, dept = null) => {
    if (!proc) return;

    if (dept) {
      setExpandedDepts(prev => ({ ...prev, [dept]: true }));
    }

    setSelectedProcess(proc);

    if (activeTab !== "dashboard") {
      setActiveTab("dashboard");
    }

    setShowExceptions(false);
    setSpecificError(null);
  };

  // دالة عادية للرندرة بدلاً من تعريفه كمكون داخلي (حل مشكلة الـ Performance/Flicker)
  const renderTreeRow = (index, style) => {
    const item = processNodes[index];
    if (!item) return null;

    if (item.type === 'department') {
      const isExpanded = expandedDepts[item.name] || searchQuery;
      return (
        <div key={`dept-${item.name}`} style={style} className="pr-2 pb-1">
          <div
            onClick={() => toggleDept(item.name)}
            className="flex items-center justify-between px-3 py-2.5 bg-slate-100/70 hover:bg-slate-200 cursor-pointer rounded-xl transition-colors border border-slate-200/50"
          >
            <div className="flex items-center gap-2">
              {isExpanded
                ? <ChevronDown size={16} className="text-[#4B367C]" />
                : <ChevronRight size={16} className="text-slate-500" />
              }
              <Folder size={14} className={isExpanded ? "text-[#4B367C] fill-[#4B367C]/20" : "text-slate-400"} />
              <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider">{item.name}</span>
            </div>
            <span className="bg-white text-slate-500 text-[10px] px-2 py-0.5 rounded-md font-bold border border-slate-200 shadow-sm">
              {item.count}
            </span>
          </div>
        </div>
      );
    }

    const proc = item.name;
    const isSelected = selectedProcess === proc;
    return (
      <div key={`proc-${proc}`} style={style} className="pr-2 pb-1 pl-6">
        <div
          onClick={() => selectProcessFromPortfolio(proc, item.dept)}
          className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
            isSelected
              ? 'bg-[#4B367C]/10 text-[#4B367C] border border-[#4B367C]/20 shadow-sm'
              : 'text-slate-500 hover:bg-slate-50 border border-transparent hover:border-slate-100 hover:translate-x-1'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <span className="truncate">{proc.replace(/_/g, ' ')}</span>
          </div>
          {isRunning && kpis.activeProcess === proc && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F37920] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F37920]"></span>
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-[#F4F7FC] font-sans overflow-hidden selection:bg-[#4B367C]/20">

      {/* ROI Configuration Modal */}
      {showRoiModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full flex flex-col animate-in zoom-in-95 duration-200 border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white rounded-t-[2rem]">
              <div className="flex items-center gap-4">
                <div className="bg-[#4B367C]/10 p-3 rounded-2xl">
                  <SlidersHorizontal size={24} className="text-[#4B367C]" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">ROI Settings</h3>
                  <p className="text-sm text-[#F37920] font-bold">{selectedProcess.replace('_', ' ')}</p>
                </div>
              </div>
              <button
                onClick={() => setShowRoiModal(false)}
                className="text-slate-400 hover:text-red-500 p-2.5 bg-white rounded-full shadow-sm border border-slate-200 transition-all"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

                        <div className="p-6 bg-slate-50 space-y-5 rounded-b-[2rem]">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Emp Minutes Per Request</label>
                <input
                  type="number"
                  value={roiForm.EmpMinutesPerRequest}
                  onChange={(e) => setRoiForm({ ...roiForm, EmpMinutesPerRequest: safeNumber(e.target.value, roiForm.EmpMinutesPerRequest) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Emp Cost Per Request ($)</label>
                <input
                  type="number"
                  value={roiForm.EmpCostPerRequest}
                  onChange={(e) => setRoiForm({ ...roiForm, EmpCostPerRequest: safeNumber(e.target.value, roiForm.EmpCostPerRequest) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Bot Cost Per Request ($)</label>
                <input
                  type="number"
                  value={roiForm.BotCostPerRequest}
                  onChange={(e) => setRoiForm({ ...roiForm, BotCostPerRequest: safeNumber(e.target.value, roiForm.BotCostPerRequest) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Expected Runs Per Day (Target)</label>
                <input
                  type="number"
                  value={roiForm.ExpectedRunsPerDay}
                  onChange={(e) => setRoiForm({ ...roiForm, ExpectedRunsPerDay: safeNumber(e.target.value, roiForm.ExpectedRunsPerDay) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>

              <button
                onClick={handleSaveROI}
                disabled={roiSaving}
                className="w-full mt-4 bg-gradient-to-r from-[#4B367C] to-[#60459c] text-white font-black py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex justify-center items-center gap-2"
              >
                {roiSaving ? <Activity size={20} className="animate-spin" /> : <Save size={20} />}
                {roiSaving ? "Saving & Recalculating..." : "Save Configuration"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exceptions Modal */}
      {showExceptions && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-red-50 to-white rounded-t-[2rem]">
              <div className="flex items-center gap-4">
                <div className="bg-red-100 p-3 rounded-2xl shadow-inner">
                  <ShieldAlert size={28} className="text-red-600" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">
                    {specificError ? "Transaction Error Details" : "System Exceptions"}
                  </h3>
                  <p className="text-sm text-red-500 font-bold">
                    {specificError ? "Detailed view of the failed request." : `${stopsTodayAll || 0} critical incidents detected.`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowExceptions(false)}
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2.5 bg-white rounded-full shadow-sm border border-slate-200 transition-all"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-slate-50 rounded-b-[2rem] space-y-4">
              {specificError ? (
                <div className="bg-white border-2 border-red-100 p-5 rounded-2xl shadow-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-bl-full blur-xl pointer-events-none"></div>
                  <div className="flex justify-between items-center mb-4 relative z-10">
                    <span className="font-black text-lg text-slate-800 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                      {(specificError.ProcessName || '').replace('_', ' ')}
                    </span>
                    <span className="text-sm font-mono bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 text-slate-600 font-bold">
                      {specificError.RequestID}
                    </span>
                  </div>
                  <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm font-semibold border border-red-100 flex items-start gap-3 relative z-10">
                    <Zap size={20} className="shrink-0 text-red-600 mt-0.5" />
                    <span className="leading-relaxed text-base">{specificError.FailureReason || "Unknown Error Occurred"}</span>
                  </div>
                </div>
              ) : (Array.isArray(failureDetailsAll) && failureDetailsAll.length > 0) ? (
                failureDetailsAll.map((fail, i) => (
                  <div key={i} className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm hover:border-red-200 hover:shadow-md transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                        {(fail.ProcessName || '').replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded-md border border-slate-200 text-slate-600">
                        {fail.RequestID}
                      </span>
                    </div>
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 border border-red-100/50">
                      <Zap size={16} className="mt-0.5 shrink-0" />
                      <span className="font-medium">{fail.FailureReason}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 opacity-50">
                  <CheckCircle2 size={48} className="text-emerald-500 mb-4" />
                  <p className="text-slate-600 font-bold text-lg">System Stable</p>
                  <p className="text-slate-400 text-sm">No specific failure reasons logged.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-[22rem] bg-white/95 backdrop-blur-xl border-r border-slate-200/60 flex flex-col shrink-0 shadow-xl z-20 print:hidden">
        <div className="p-8 pb-4 flex-1 flex flex-col">
          <img
            src="/fgs-logo.png"
            alt="FGS Solutions"
            className="h-10 w-full object-contain mb-8 drop-shadow-sm cursor-pointer hover:scale-105 transition-transform"
          />

          <div className="mb-6">
            <p className="text-[0.65rem] font-bold tracking-[0.2em] text-slate-400 uppercase mb-3 ml-2">Control Center</p>
            <ul className="space-y-1.5">
              <li
                onClick={() => { setActiveTab("dashboard"); setSelectedProcess("All"); }}
                className={`px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 cursor-pointer transition-all ${
                  activeTab === "dashboard" && selectedProcess === "All"
                    ? 'bg-[#4B367C] text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-50 hover:translate-x-1'
                }`}
              >
                <LayoutDashboard size={18} className={activeTab === "dashboard" && selectedProcess === "All" ? 'text-white' : 'text-slate-400'} />
                Global Dashboard
              </li>

              <li
                onClick={() => setActiveTab("workload")}
                className={`px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 cursor-pointer transition-all ${
                  activeTab === "workload"
                    ? 'bg-[#4B367C] text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-50 hover:translate-x-1'
                }`}
              >
                <ListTodo size={18} className={activeTab === "workload" ? 'text-white' : 'text-slate-400'} />
                Workload & SLA
              </li>

              <li
                onClick={() => setActiveTab("infrastructure")}
                className={`px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 cursor-pointer transition-all ${
                  activeTab === "infrastructure"
                    ? 'bg-[#4B367C] text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-50 hover:translate-x-1'
                }`}
              >
                <Server size={18} className={activeTab === "infrastructure" ? 'text-white' : 'text-slate-400'} />
                Infrastructure
              </li>

              {/* حل المشكلة 3: تم إضافة زر التنقل لصفحة دورة حياة البوتات */}
              {/*<li
                onClick={() => setActiveTab("lifecycle")}
                className={`px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 cursor-pointer transition-all ${
                  activeTab === "lifecycle"
                    ? 'bg-[#4B367C] text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-50 hover:translate-x-1'
                }`}
              >
                <GitBranch size={18} className={activeTab === "lifecycle" ? 'text-white' : 'text-slate-400'} />
                Bot Lifecycle
              </li>*/}

              {(userRole === 'SuperAdmin' || userRole === 'CoE_Manager') && (
                <li
                  onClick={() => setActiveTab("audit")}
                  className={`px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 cursor-pointer transition-all ${
                    activeTab === "audit"
                      ? 'bg-[#4B367C] text-white shadow-md'
                      : 'text-slate-500 hover:bg-slate-50 hover:translate-x-1'
                  }`}
                >
                  <ShieldCheck size={18} className={activeTab === "audit" ? 'text-white' : 'text-slate-400'} />
                  Audit Trails
                </li>
              )}
            </ul>
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-6"></div>

          {/* Processes Portfolio */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex justify-between items-center mb-3 ml-2 pr-2">
              <p className="text-[0.65rem] font-bold tracking-[0.15em] text-[#F37920] uppercase">Processes Portfolio</p>
              <span className="bg-[#F37920]/10 text-[#F37920] px-2 py-0.5 rounded-md text-[0.65rem] font-black">
                {processConfigs.length.toLocaleString()} loaded
              </span>
            </div>

            <div className="relative mb-3">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search size={14} className="text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Prefix search (enterprise)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 pl-10 pr-9 py-2.5 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-[#4B367C] focus:bg-white focus:ring-2 focus:ring-[#4B367C]/10 transition-all shadow-sm placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-hidden relative">
              {processNodes.length > 0 ? (
                <VirtualTreeList
                  height={380}
                  itemCount={processNodes.length}
                  itemSize={42}
                  onEndReached={() => fetchProcessesPage({ reset: false })}
                >
                  {(index, style) => renderTreeRow(index, style)}
                </VirtualTreeList>
              ) : (
                <div className="text-center text-slate-400 text-xs font-bold py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  {isLoadingProcesses ? 'Loading...' : 'No matches found'}
                </div>
              )}

              {isLoadingProcesses && (
                <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                  <div className="bg-white/80 backdrop-blur px-3 py-1 rounded-full border border-slate-200 text-[10px] font-black text-slate-600 shadow-sm">
                    Loading more...
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto p-6 bg-slate-50/80 border-t border-slate-100 space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center hover:-translate-y-1 transition-transform">
            <div>
              <p className="text-[0.6rem] text-slate-400 font-extrabold uppercase">Global Success</p>
              <p className="text-2xl font-black text-[#4B367C]">{(sidebarStats.successRate ?? 0)}%</p>
            </div>
            <div className="w-10 h-10 rounded-full flex items-center justify-center relative bg-emerald-50">
              <CheckCircle2 size={20} className="text-[#10B981]" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "audit" ? (
        <div className="flex-1 overflow-hidden relative z-10 bg-white">
          <AuditTrails token={token} />
        </div>
      ) : activeTab === "workload" ? (
        <div className="flex-1 overflow-hidden relative z-10 bg-white">
          <WorkloadControl token={token} userRole={userRole} />
        </div>
      ) : activeTab === "infrastructure" ? (
        <div className="flex-1 overflow-hidden relative z-10 bg-white">
          <InfrastructureHealth token={token} userRole={userRole} />
        </div>
      ) : activeTab === "lifecycle" ? (
        <div className="flex-1 overflow-hidden relative z-10 bg-white">
          <BotLifecycleView
            token={token}
            userRole={userRole}
            initialProcess={selectedProcess}
            processConfigs={processConfigs}
            onSyncRequested={() => {
              fetchData(true);
              fetchProcessesPage({ reset: true });
            }}
          />
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto p-10 xl:p-12 print:p-0 print:overflow-visible relative z-10 transition-opacity duration-300 ${isSwitching ? 'opacity-40 pointer-events-none' : 'opacity-100 animate-in fade-in slide-in-from-bottom-4 duration-500'}`}>

          {/* Header */}
          <div className="flex justify-between items-end mb-10 print:mb-6">
            <div>
              <h2 className="text-4xl font-black text-[#4B367C] tracking-tight flex items-center gap-3">
                Executive Dashboard
              </h2>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs bg-[#4B367C]/10 text-[#4B367C] px-3 py-1 rounded-full font-black uppercase tracking-widest">{userRole}</span>
                <p className="text-sm text-slate-500 font-bold tracking-wide">Welcome, {userName}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 print:hidden">
              {/* ===== Premium Date Filter Dropdown ===== */}
<div className="relative">
  <button
    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
    className={`flex items-center gap-3 bg-white border-2 rounded-full pl-4 pr-3 py-2.5 shadow-sm text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer group ${
      isDropdownOpen
        ? 'border-[#4B367C] shadow-md shadow-[#4B367C]/10'
        : 'border-slate-200 hover:border-[#4B367C]/60 hover:shadow-md'
    }`}
  >
    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-[#F37920]/15 to-[#F37920]/5">
      <Calendar size={14} className="text-[#F37920]" />
    </div>
    <span className="text-slate-700">
      {dateFilter === 'all_time' && 'All Time'}
      {dateFilter === 'today' && 'Today'}
      {dateFilter === '7days' && 'Last 7 Days'}
      {dateFilter === 'this_month' && 'This Month'}
    </span>
    <div className={`flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180 bg-[#4B367C]/10' : 'group-hover:bg-slate-200'}`}>
      <ChevronDown size={14} className={isDropdownOpen ? 'text-[#4B367C]' : 'text-slate-400'} />
    </div>
  </button>

  {isDropdownOpen && (
    <>
      {/* Backdrop خفيف عشان يقفل لما تضغط بره */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setIsDropdownOpen(false)}
      />

      <div className="absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-2xl shadow-slate-300/40 border border-slate-100/80 py-2 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200">
        {/* Header صغير جوه المنيو */}
        <div className="px-4 pt-2 pb-3 border-b border-slate-100 mb-1">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
            Reporting Period
          </p>
        </div>

        {[
          {
            id: 'all_time',
            label: 'All Time',
            desc: 'Full historical data',
            icon: '∞'
          },
          {
            id: 'today',
            label: 'Today',
            desc: 'Last 24 hours only',
            icon: '◉'
          },
          {
            id: '7days',
            label: 'Last 7 Days',
            desc: 'Rolling weekly view',
            icon: '7'
          },
          {
            id: 'this_month',
            label: 'This Month',
            desc: 'Current calendar month',
            icon: 'M'
          },
        ].map((item) => {
          const isActive = dateFilter === item.id;
          return (
            <div
              key={item.id}
              onClick={() => {
                setDateFilter(item.id);
                setIsDropdownOpen(false);
              }}
              className={`mx-2 my-0.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 flex items-center gap-3 group/item ${
                isActive
                  ? 'bg-gradient-to-r from-[#4B367C] to-[#5c4096] text-white shadow-md shadow-[#4B367C]/25'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#4B367C]'
              }`}
            >
              {/* أيقونة دائرية */}
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 transition-all ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-500 group-hover/item:bg-[#4B367C]/10 group-hover/item:text-[#4B367C]'
                }`}
              >
                {item.icon}
              </div>

              <div className="flex-1 min-w-0">
                <p className={`text-xs font-black leading-tight ${isActive ? 'text-white' : ''}`}>
                  {item.label}
                </p>
                <p className={`text-[10px] mt-0.5 truncate ${isActive ? 'text-white/70' : 'text-slate-400'}`}>
                  {item.desc}
                </p>
              </div>

              {/* Check mark للخيار النشط */}
              {isActive && (
                <Check size={16} className="text-emerald-300 shrink-0" strokeWidth={3} />
              )}
            </div>
          );
        })}

        {/* Footer بسيط */}
        <div className="mx-2 mt-1 mb-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
          <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F37920] animate-pulse"></span>
            Live data auto-refreshes every 15s
          </p>
        </div>
      </div>
    </>
  )}
</div>

              {selectedProcess !== "All" && (userRole === 'SuperAdmin' || userRole === 'CoE_Manager') && (
                <button
                  onClick={openRoiModal}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-white border border-[#F37920]/40 text-[#F37920] shadow-sm hover:bg-[#F37920] hover:text-white transition-colors font-black uppercase tracking-wider text-xs"
                >
                  <SlidersHorizontal size={16} /> Configure ROI
                </button>
              )}

              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-5 py-3 rounded-full bg-slate-800 text-white shadow-md hover:bg-slate-700 transition-colors font-black uppercase tracking-wider text-xs"
              >
                <Download size={16} /> Export PDF
              </button>

              <button
                onClick={onLogout}
                className="flex items-center gap-2 px-4 py-3 rounded-full bg-red-50 text-red-600 border border-red-100 shadow-sm hover:bg-red-500 hover:text-white transition-colors font-black uppercase tracking-wider text-xs"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5 mb-8 print:grid-cols-5">
            <div className="bg-[#4B367C] p-6 rounded-[2rem] shadow-lg text-white flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-all"></div>
              <Settings size={28} className="mb-4 opacity-80" />
              <h3 className="text-5xl font-black relative z-10">{Number(kpis.totalProcedures || 0).toLocaleString()}</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4B367C] bg-white w-fit px-3 py-1.5 rounded-lg mt-3 shadow-sm relative z-10">Total Procedures</p>
            </div>

            <div className="bg-[#10B981] p-6 rounded-[2rem] shadow-lg text-white flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-all"></div>
              <Clock size={28} className="mb-4 opacity-80" />
              <h3 className="text-5xl font-black relative z-10">
                {Number(kpis.timeSaved || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{' '}
                <span className="text-xl opacity-80">hrs</span>
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#10B981] bg-white w-fit px-3 py-1.5 rounded-lg mt-3 shadow-sm relative z-10">Total Time Saved</p>
            </div>

            <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-[2rem] shadow-lg text-white flex flex-col justify-between relative overflow-hidden group hover:shadow-2xl transition-all">
              <div className="absolute -right-4 -top-4 w-32 h-32 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all"></div>
              <div className="flex justify-between items-start mb-2 relative z-10">
                <Users size={28} className="text-blue-400 opacity-90" />
                <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 px-2 py-1 rounded border border-blue-500/30">Workforce</span>
              </div>
              <h3 className="text-5xl font-black relative z-10">
                {(Number(kpis.timeSaved || 0) / 8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{' '}
                <span className="text-xl opacity-70 font-medium">FTEs</span>
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-3 relative z-10">Virtual Employees</p>
            </div>

            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <TrendingUp size={28} className="text-[#F37920]" />
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">Financial ROI</span>
              </div>
              <h3 className="text-4xl font-black text-slate-800 truncate">
                <span className="text-xl text-[#F37920] mr-1">$</span>{formatCurrency(kpis.costSaved)}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-2">Capital Saved</p>
            </div>

            {/* حل المشكلة 1: تم تصحيح الكارت الخامس (الاستثناءات) ليكون نظيفاً وغير متداخل */}
            <div
              onClick={() => Number(stopsTodayAll) > 0 && openExceptionsModal()}
              className={`p-6 rounded-[2rem] border flex flex-col justify-between transition-all duration-300 group ${
                Number(stopsTodayAll) > 0
                  ? 'bg-red-50 border-red-200 shadow-md cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:border-red-400'
                  : 'bg-white border-slate-200 shadow-sm print:shadow-none'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <ShieldAlert size={28} className={Number(stopsTodayAll) > 0 ? "text-red-500" : "text-slate-400"} />
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                  Number(stopsTodayAll) > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  Status
                </span>
              </div>

              <h3 className={`text-5xl font-black ${Number(stopsTodayAll) > 0 ? 'text-red-500' : 'text-slate-800'}`}>
                {Number(stopsTodayAll).toLocaleString()}
              </h3>

              <p className={`text-[10px] font-bold uppercase tracking-widest mt-2 ${
                Number(stopsTodayAll) > 0 ? 'text-red-400 group-hover:underline' : 'text-slate-400'
              }`}>
                {Number(stopsTodayAll) > 0 ? 'Exceptions (Click)' : 'No Exceptions'}
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 print:break-inside-avoid">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200 lg:col-span-1 flex flex-col items-center justify-center hover:shadow-md transition-shadow">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-2 w-full text-left">Processes per Status</h3>
              <div className="h-52 w-full relative mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Array.isArray(analytics.statusDistribution) ? analytics.statusDistribution : []}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {(Array.isArray(analytics.statusDistribution) ? analytics.statusDistribution : []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-4 w-full">
                {(Array.isArray(analytics.statusDistribution) ? analytics.statusDistribution : []).map((st, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                    <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></span>
                    {st.name} ({st.value})
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200 lg:col-span-2 hover:shadow-md transition-shadow">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-6">Total Cost Saved Daily Trend</h3>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={Array.isArray(charts.savings) ? charts.savings : []} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="orangeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F37920" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F37920" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94A3B8' }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 'bold' }}
                      formatter={(value) => [`$ ${formatCurrency(value)}`]}
                    />
                    <Area type="monotone" dataKey="bar" stroke="#F37920" strokeWidth={4} fill="url(#orangeGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent Runs Table */}
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-8 hover:shadow-md transition-shadow print:break-inside-avoid">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="text-sm font-black text-[#4B367C] uppercase tracking-wider">Active Process Runs Log</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-100">
                    <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Process</th>
                    <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Trace ID</th>
                    <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider">Runtime</th>
                    <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-wider text-right">Value Yield</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {table.map((run, idx) => {
                    const costSaved = run?.CostSaved ?? run?.DynamicCostSaved ?? run?.CostSavedForTable ?? 0;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-8 py-4 font-extrabold text-[#4B367C] text-sm">
                          {(run.ProcessName || '').replace(/_/g, ' ')}
                        </td>
                        <td className="px-8 py-4">
                          <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-lg font-bold border border-slate-200">
                            {run.RequestID}
                          </span>
                        </td>
                        <td className="px-8 py-4">
                          <span
                            onClick={() => (run.Status === 'Failed' || run.Status === 'Stopped') && openExceptionsModal(run)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black uppercase transition-all ${statusPillClass(run.Status)}`}
                            title={(run.Status === 'Failed' || run.Status === 'Stopped') ? 'Click to view error reason' : ''}
                          >
                            {run.Status === 'Completed' && <CheckCircle2 size={14} strokeWidth={3} />}
                            {run.Status === 'Running' && <Activity size={14} className="animate-spin-slow" strokeWidth={3} />}
                            {(run.Status === 'Failed' || run.Status === 'Stopped') && <AlertCircle size={14} strokeWidth={3} />}
                            {run.Status}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-sm text-slate-500 font-bold">
                          {run.DurationMinutes ? `${run.DurationMinutes} m` : <span className="text-[#F37920] animate-pulse bg-[#F37920]/10 px-3 py-1 rounded-lg">Running...</span>}
                        </td>
                        <td className="px-8 py-4 text-sm font-black text-slate-900 text-right">
                          {Number(costSaved) > 0 ? `$ ${formatCurrency(costSaved)}` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {table.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-8 py-10 text-center text-slate-400 font-bold">
                        No recent runs found.
                      </td>
                    </tr>
                  )}
                </tbody>

              </table>
            </div>
          </div>

        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .animate-spin-slow { animation: spin 3s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        @media print {
          body { background: white !important; }
          .animate-pulse, .animate-spin, .animate-spin-slow { animation: none !important; }
        }
      `}} />
    </div>
  );
}