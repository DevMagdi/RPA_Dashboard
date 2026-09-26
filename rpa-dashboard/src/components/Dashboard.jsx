import React, { useState, useEffect, useMemo, useRef } from 'react';
import AuditTrails from './AuditTrails';
import WorkloadControl from './WorkloadControl';
import InfrastructureHealth from './InfrastructureHealth';
import {
  LayoutDashboard, Activity, CheckCircle2, Clock, TrendingUp, AlertCircle,
  X, Zap, ChevronRight, ChevronDown, Folder, Settings, ShieldAlert, Cpu,
  SlidersHorizontal, Save, Users, Download, Calendar, LogOut, Search,
  ShieldCheck, ListTodo, Server
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
  children: RenderComponent
}) => {
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - 2);
  const endIndex = Math.min(itemCount - 1, startIndex + Math.ceil(height / itemSize) + 6);

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push(
      <RenderComponent
        key={i}
        index={i}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: itemSize,
          transform: `translateY(${i * itemSize}px)`
        }}
      />
    );
  }

  const handleScroll = (e) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);

    // Infinite scroll trigger
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

const dateFilterToDays = (dateFilter) => {
  switch (dateFilter) {
    case 'today': return 1;
    case '7days': return 7;
    case 'this_month': return 30;
    case 'all_time':
    default:
      return 730; // max allowed in backend
  }
};

const statusPillClass = (status) => {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-600 border border-emerald-100';
  if (status === 'Running') return 'bg-[#F37920]/10 text-[#F37920] border border-[#F37920]/30';
  if (status === 'Failed' || status === 'Stopped') return 'bg-red-50 text-red-600 border border-red-200 cursor-pointer hover:bg-red-100 hover:scale-[1.02] shadow-sm';
  return 'bg-slate-50 text-slate-600 border border-slate-200';
};

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

  // ROI form (prefill best-effort)
  const [roiForm, setRoiForm] = useState({
    EmpMinutesPerRequest: 15,
    EmpCostPerRequest: 10,
    BotCostPerRequest: 0.5,
    ExpectedRunsPerDay: 50
  });

  // Enterprise processes (server pagination)
  const [processConfigs, setProcessConfigs] = useState([]);  // loaded items only (not all)
  const [processCursor, setProcessCursor] = useState(null);
  const [isLoadingProcesses, setIsLoadingProcesses] = useState(false);
  const [hasMoreProcesses, setHasMoreProcesses] = useState(true);

  const processesReqId = useRef(0);
  const dashboardReqId = useRef(0);
  const searchDebounceRef = useRef(null);

  const PIE_COLORS = ['#4B367C', '#F37920', '#10B981', '#EF4444'];

  // ------------------------------------------
  // Dashboard data (KPIs + Charts)
  // ------------------------------------------
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

  // ------------------------------------------
  // Processes list (Keyset pagination)
  // Backend search is prefix search.
  // ------------------------------------------
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

  // initial load dashboard
  useEffect(() => {
    fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcess, dateFilter, token]);

  // auto refresh dashboard
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcess, dateFilter, token]);

  // processes load on token/search change (debounced)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, token]);

  // first processes load
  useEffect(() => {
    if (!token) return;
    if (processConfigs.length === 0) {
      fetchProcessesPage({ reset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ------------------------------------------
  // Tree nodes (from LOADED processes only)
  // ------------------------------------------
  const processNodes = useMemo(() => {
    // group loaded processes by department
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

  // Best-effort prefill ROI:
  // - new enterprise backend doesn't ship full configList
  // - if /api/processes later includes ROI fields, this will auto-prefill
  const openRoiModal = async () => {
    // default values
    let prefill = {
      EmpMinutesPerRequest: roiForm.EmpMinutesPerRequest ?? 0,
      EmpCostPerRequest: roiForm.EmpCostPerRequest ?? 0,
      BotCostPerRequest: roiForm.BotCostPerRequest ?? 0,
      ExpectedRunsPerDay: roiForm.ExpectedRunsPerDay ?? 0,
    };

    // try from loaded cache first
    const cached = processConfigs.find(c => c.ProcessName === selectedProcess);
    if (cached) {
      prefill = {
        EmpMinutesPerRequest: cached.EmpMinutesPerRequest ?? prefill.EmpMinutesPerRequest,
        EmpCostPerRequest: cached.EmpCostPerRequest ?? prefill.EmpCostPerRequest,
        BotCostPerRequest: cached.BotCostPerRequest ?? prefill.BotCostPerRequest,
        ExpectedRunsPerDay: cached.ExpectedRunsPerDay ?? prefill.ExpectedRunsPerDay,
      };
    } else {
      // try fetch a small page that should include the exact process (prefix search)
      try {
        const url = new URL(`${API_BASE}/api/processes`);
        url.searchParams.set('page_size', '50');
        url.searchParams.set('search', selectedProcess); // prefix
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
      } catch (_) {
        // ignore
      }
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
        ...roiForm
      })
    })
      .then(res => res.json())
      .then(resData => {
        setRoiSaving(false);
        if (resData.status === "success") {
          setShowRoiModal(false);
          fetchData(false);
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

  // Safe defaults (enterprise API may omit some analytics fields)
  const safe = data || {};
  const kpis = safe.kpis || {};
  const sidebarStats = safe.sidebarStats || { successRate: 0, errorRate: 0, bookedRuns: 0 };
  const analytics = safe.analytics || {};
  const charts = safe.charts || { volume: [], savings: [] };
  const table = Array.isArray(safe.table) ? safe.table : [];
  const isRunning = kpis.status === 'Running';

  const RenderTreeRow = ({ index, style }) => {
    const item = processNodes[index];
    if (!item) return null;

    if (item.type === 'department') {
      const isExpanded = expandedDepts[item.name] || searchQuery;
      return (
        <div style={style} className="pr-2 pb-1">
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
    const isSelected = activeTab === "dashboard" && selectedProcess === proc;
    return (
      <div style={style} className="pr-2 pb-1 pl-6">
        <div
          onClick={() => { setActiveTab("dashboard"); setSelectedProcess(proc); }}
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
                  onChange={(e) => setRoiForm({ ...roiForm, EmpMinutesPerRequest: parseFloat(e.target.value) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Emp Cost Per Request (EGP)</label>
                <input
                  type="number"
                  value={roiForm.EmpCostPerRequest}
                  onChange={(e) => setRoiForm({ ...roiForm, EmpCostPerRequest: parseFloat(e.target.value) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Bot Cost Per Request (EGP)</label>
                <input
                  type="number"
                  value={roiForm.BotCostPerRequest}
                  onChange={(e) => setRoiForm({ ...roiForm, BotCostPerRequest: parseFloat(e.target.value) })}
                  className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:ring-1 focus:ring-[#4B367C]"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Expected Runs Per Day (Target)</label>
                <input
                  type="number"
                  value={roiForm.ExpectedRunsPerDay}
                  onChange={(e) => setRoiForm({ ...roiForm, ExpectedRunsPerDay: parseInt(e.target.value) })}
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
                    {specificError ? "Detailed view of the failed request." : `${kpis.stopsToday || 0} critical incidents detected.`}
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
              ) : (Array.isArray(kpis.failureDetails) && kpis.failureDetails.length > 0) ? (
                kpis.failureDetails.map((fail, i) => (
                  <div key={i} className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm hover:border-red-200 hover:shadow-md transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                        {(fail.ProcessName || '').replace('_', ' ')}
                      </span>
                      <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded-md border border-slate-200 text-slate-600">{fail.RequestID}</span>
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

          {/* Processes Portfolio (Enterprise: paged from /api/processes) */}
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
                  {RenderTreeRow}
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
              <div className="relative">
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-3 bg-white border border-slate-200 hover:border-[#4B367C] rounded-full px-5 py-3 shadow-sm text-xs font-black text-slate-700 uppercase tracking-wider transition-all cursor-pointer"
                >
                  <Calendar size={16} className="text-[#F37920]" />
                  <span>
                    {dateFilter === 'all_time' && 'All Time'}
                    {dateFilter === 'today' && 'Today'}
                    {dateFilter === '7days' && 'Last 7 Days'}
                    {dateFilter === 'this_month' && 'This Month'}
                  </span>
                  <ChevronRight size={14} className={`transform transition-transform text-slate-400 ${isDropdownOpen ? 'rotate-90' : 'rotate-0'}`} />
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                    {[
                      { id: 'all_time', label: 'All Time' },
                      { id: 'today', label: 'Today' },
                      { id: '7days', label: 'Last 7 Days' },
                      { id: 'this_month', label: 'This Month' },
                    ].map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setDateFilter(item.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`px-5 py-2.5 text-xs font-bold cursor-pointer transition-colors ${
                          dateFilter === item.id
                            ? 'bg-[#4B367C] text-white font-black'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-[#4B367C]'
                        }`}
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
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
                <span className="text-xl text-[#F37920] mr-1">EGP</span>{formatCurrency(kpis.costSaved)}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-2">Capital Saved</p>
            </div>

            <div
              onClick={() => Number(kpis.stopsToday || 0) > 0 && openExceptionsModal()}
              className={`p-6 rounded-[2rem] border flex flex-col justify-between transition-all duration-300 group ${
                Number(kpis.stopsToday || 0) > 0
                  ? 'bg-red-50 border-red-200 shadow-md cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:border-red-400'
                  : 'bg-white border-slate-200 shadow-sm print:shadow-none'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <ShieldAlert size={28} className={Number(kpis.stopsToday || 0) > 0 ? "text-red-500" : "text-slate-400"} />
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                  Number(kpis.stopsToday || 0) > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  Status
                </span>
              </div>
              <h3 className={`text-5xl font-black ${Number(kpis.stopsToday || 0) > 0 ? 'text-red-500' : 'text-slate-800'}`}>
                {Number(kpis.stopsToday || 0).toLocaleString()}
              </h3>
              <p className={`text-[10px] font-bold uppercase tracking-widest mt-2 ${
                Number(kpis.stopsToday || 0) > 0 ? 'text-red-400 group-hover:underline' : 'text-slate-400'
              }`}>
                {Number(kpis.stopsToday || 0) > 0 ? 'Exceptions (Click)' : 'No Exceptions'}
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
                      formatter={(value) => [`EGP ${formatCurrency(value)}`]}
                    />
                    <Area type="monotone" dataKey="bar" stroke="#F37920" strokeWidth={4} fill="url(#orangeGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent Runs Table (Enterprise colored status) */}
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
                          {Number(costSaved) > 0 ? `EGP ${formatCurrency(costSaved)}` : '-'}
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