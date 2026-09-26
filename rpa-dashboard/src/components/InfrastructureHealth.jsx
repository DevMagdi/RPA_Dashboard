import React, { useState, useEffect } from 'react';
import { Server, Cpu, HardDrive, AlertOctagon, CheckCircle2, Clock, Activity, PowerOff, Plus, X, Save, Database, Edit } from 'lucide-react';

export default function InfrastructureHealth({ token, userRole }) {
  const [infraData, setInfraData] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [machineForm, setMachineForm] = useState({
    MachineName: '',
    AssignedBot: '',
    RunnerType: 'Unattended',
    TotalRAM_GB: 16,
    TotalHDD_GB: 500
  });

  const fetchInfraData = () => {
    fetch('http://127.0.0.1:8000/api/infrastructure', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (!data.error) setInfraData(data);
      setLoading(false);
    })
    .catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchInfraData();
    const interval = setInterval(fetchInfraData, 10000);
    return () => clearInterval(interval);
  }, [token]);

  const handleRegisterMachine = () => {
    setIsSaving(true);
    fetch('http://127.0.0.1:8000/api/register-machine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(machineForm)
    })
    .then(res => res.json())
    .then(resData => {
      setIsSaving(false);
      if (resData.status === "success") {
        setShowAddModal(false);
        fetchInfraData();
      } else alert(resData.message);
    });
  };

  const handleUpdateMachine = () => {
    setIsSaving(true);
    fetch('http://127.0.0.1:8000/api/update-machine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(machineForm)
    })
    .then(res => res.json())
    .then(resData => {
      setIsSaving(false);
      if (resData.status === "success") {
        setShowEditModal(false);
        fetchInfraData();
      } else alert(resData.message);
    });
  };

  const openEditModal = (machine) => {
    setMachineForm({
      MachineName: machine.MachineName,
      AssignedBot: machine.AssignedBot,
      RunnerType: machine.RunnerType,
      TotalRAM_GB: machine.TotalRAM_GB,
      TotalHDD_GB: machine.TotalHDD_GB
    });
    setShowEditModal(true);
  };

  if (loading && infraData.length === 0) return (
    <div className="flex h-full items-center justify-center bg-slate-50/50">
      <div className="w-12 h-12 border-4 border-[#4B367C] border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  const healthyCount = infraData.filter(m => m.HealthStatus === 'Healthy' || m.HealthStatus === 'Idle').length;
  const issueCount = infraData.filter(m => m.HealthStatus === 'Critical' || m.HealthStatus === 'Warning').length;
  const isAdmin = userRole === 'SuperAdmin' || userRole === 'CoE_Manager';

  return (
    <div className="p-10 xl:p-12 animate-in fade-in duration-500 h-full overflow-y-auto w-full bg-slate-50/50">

      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-4xl font-black text-[#4B367C] tracking-tight flex items-center gap-3">
            <Server size={36} className="text-[#F37920]" />
            Infrastructure & Runners
          </h2>
          <p className="text-sm text-slate-500 font-bold tracking-wide mt-2">
            VM specifications, real-time resource utilization, and bot agent heartbeats.
          </p>
        </div>

        <div className="flex gap-4 items-center">
          {isAdmin && (
            <button onClick={() => {
              setMachineForm({ MachineName: '', AssignedBot: '', RunnerType: 'Unattended', TotalRAM_GB: 16, TotalHDD_GB: 500 });
              setShowAddModal(true);
            }} className="bg-[#4B367C] text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-[#3a2a61] shadow-md transition-all">
              <Plus size={18} /> Register Runner
            </button>
          )}
          <div className="bg-white px-5 py-3 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
             <div className="bg-emerald-50 p-2 rounded-xl text-emerald-600"><CheckCircle2 size={20}/></div>
             <div>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Healthy VMs</p>
               <p className="text-xl font-black text-slate-800">{healthyCount}</p>
             </div>
          </div>
        </div>
      </div>

      {/* Grid of Machines */}
      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
        {infraData.map((machine, idx) => {
          const isCritical = machine.HealthStatus === 'Critical';
          const isWarning = machine.HealthStatus === 'Warning';

          return (
            <div key={idx} className={`bg-white p-6 rounded-[2rem] border-2 shadow-sm transition-all duration-300 relative overflow-hidden group ${
              isCritical ? 'border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 
              isWarning ? 'border-amber-300' : 'border-slate-200 hover:border-[#4B367C]/30'
            }`}>

              <div className={`absolute top-0 left-0 w-full h-1.5 ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-500'}`}></div>

              <div className="flex justify-between items-start mb-6 mt-2">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${isCritical ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                    {isCritical ? <PowerOff size={24} /> : <Server size={24} />}
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 text-lg truncate pr-2 flex items-center gap-2">
                      {machine.MachineName}
                      {isAdmin && (
                        <button onClick={() => openEditModal(machine)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-[#4B367C] bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                          <Edit size={14} />
                        </button>
                      )}
                    </h3>
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                      <Activity size={12} className="text-[#F37920]"/> {machine.RunnerType} • {machine.AssignedBot.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border flex items-center gap-1.5 ${
                  isCritical ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                }`}>
                  {!isCritical && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>}
                  {machine.Status}
                </span>
              </div>

              {/* VM Specifications */}
              <div className="flex justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 mb-6">
                <div className="text-center w-1/2 border-r border-slate-200">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Total RAM</p>
                  <p className="text-sm font-black text-slate-700">{machine.TotalRAM_GB} GB</p>
                </div>
                <div className="text-center w-1/2">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Total HDD</p>
                  <p className="text-sm font-black text-slate-700">{machine.TotalHDD_GB} GB</p>
                </div>
              </div>

              {/* Resources (CPU, RAM, HDD) */}
              <div className="space-y-4 mb-6">
                <div>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-xs font-black text-slate-500 flex items-center gap-1"><Cpu size={14}/> CPU</span>
                    <span className={`text-sm font-black ${machine.CPU_Usage >= 90 ? 'text-red-500' : 'text-slate-700'}`}>{machine.CPU_Usage}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-1000 ${machine.CPU_Usage >= 90 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${isCritical ? 0 : machine.CPU_Usage}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-xs font-black text-slate-500 flex items-center gap-1"><Database size={14}/> RAM</span>
                    <span className={`text-sm font-black ${machine.RAM_Usage >= 90 ? 'text-red-500' : 'text-slate-700'}`}>{machine.RAM_Usage}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-1000 ${machine.RAM_Usage >= 90 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${isCritical ? 0 : machine.RAM_Usage}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-xs font-black text-slate-500 flex items-center gap-1"><HardDrive size={14}/> Disk</span>
                    <span className={`text-sm font-black ${machine.HDD_Usage >= 90 ? 'text-red-500' : 'text-slate-700'}`}>{machine.HDD_Usage}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-1000 ${machine.HDD_Usage >= 90 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${isCritical ? 0 : machine.HDD_Usage}%` }}></div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-xs">
                <span className="font-bold text-slate-400 flex items-center gap-1.5"><Clock size={14}/> Last Agent Ping:</span>
                <span className={`font-black ${isCritical ? 'text-red-500' : 'text-slate-700'}`}>{machine.LastPing}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* نافذة التسجيل أو التعديل */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white rounded-t-[2rem]">
              <h3 className="text-xl font-black text-slate-900">{showEditModal ? 'Update Bot Runner' : 'Register Bot Runner'}</h3>
              <button onClick={() => { setShowAddModal(false); setShowEditModal(false); }} className="text-slate-400 hover:text-red-500 bg-white rounded-full p-2"><X size={20}/></button>
            </div>
            <div className="p-6 bg-slate-50 space-y-4 rounded-b-[2rem]">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Machine Name (Hostname)</label>
                  <input type="text" disabled={showEditModal} value={machineForm.MachineName} onChange={(e) => setMachineForm({...machineForm, MachineName: e.target.value})} className={`w-full border-slate-200 p-3 rounded-xl font-bold ${showEditModal ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : ''}`} placeholder="e.g. VM-FIN-PROD-01" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Assigned Bot</label>
                  <input type="text" value={machineForm.AssignedBot} onChange={(e) => setMachineForm({...machineForm, AssignedBot: e.target.value})} className="w-full border-slate-200 p-3 rounded-xl font-bold" placeholder="e.g. Invoice_Bot" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Runner Type</label>
                  <select value={machineForm.RunnerType} onChange={(e) => setMachineForm({...machineForm, RunnerType: e.target.value})} className="w-full border-slate-200 p-3 rounded-xl font-bold text-slate-700">
                    <option value="Unattended">Unattended</option>
                    <option value="Attended">Attended</option>
                    <option value="Bot Creator">Bot Creator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Total RAM (GB)</label>
                  <input type="number" value={machineForm.TotalRAM_GB} onChange={(e) => setMachineForm({...machineForm, TotalRAM_GB: parseInt(e.target.value)})} className="w-full border-slate-200 p-3 rounded-xl font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Total Disk (GB)</label>
                  <input type="number" value={machineForm.TotalHDD_GB} onChange={(e) => setMachineForm({...machineForm, TotalHDD_GB: parseInt(e.target.value)})} className="w-full border-slate-200 p-3 rounded-xl font-bold" />
                </div>
              </div>
              <button onClick={showEditModal ? handleUpdateMachine : handleRegisterMachine} disabled={isSaving} className="w-full mt-4 bg-[#4B367C] text-white font-black py-4 rounded-xl flex justify-center items-center gap-2 hover:bg-[#3a2a61] shadow-lg">
                {isSaving ? <Activity className="animate-spin" /> : <Save />} {showEditModal ? 'Save Changes' : 'Register VM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}