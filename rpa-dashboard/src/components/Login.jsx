import React, { useState } from 'react';
import { Activity, Shield, User, Lock, ArrowRight, Server } from 'lucide-react';

export default function Login({ onLoginSuccess }) {
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    const formData = new URLSearchParams();
    formData.append('username', loginForm.username);
    formData.append('password', loginForm.password);

    fetch('http://127.0.0.1:8000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    })
    .then(res => res.json().then(data => ({ status: res.status, body: data })))
    .then(res => {
      setIsLoggingIn(false);
      if (res.status === 200) {
        onLoginSuccess(res.body.access_token, res.body.role, res.body.username);
      } else {
        setLoginError(res.body.detail || "Invalid credentials");
      }
    })
    .catch(() => {
      setIsLoggingIn(false);
      setLoginError("Connection to CoE server failed");
    });
  };

  return (
    // الخلفية الهادئة النظيفة (نفس لون خلفية الداشبورد لراحة العين)
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center p-4 sm:p-8 font-sans selection:bg-[#4B367C]/20">

      {/* البطاقة العائمة الرئيسية (Floating Card) */}
      <div className="max-w-5xl w-full bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col md:flex-row min-h-[600px] border border-slate-100">

        {/* النصف الأيسر - الطابع المؤسسي الفخم (Dark Navy / Purple) */}
        <div className="w-full md:w-5/12 bg-gradient-to-b from-[#2E1E5B] to-[#1A103C] p-12 flex flex-col justify-between relative overflow-hidden">
          {/* تأثيرات خلفية خفيفة جداً (Subtle Shapes) */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-10 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-64 h-64 rounded-full border-[20px] border-white"></div>
            <div className="absolute bottom-10 -right-10 w-40 h-40 rounded-full border-[10px] border-white"></div>
          </div>

          {/* لوجو الشركة والترحيب */}
          <div className="relative z-10">
            {/* اللوجو (إذا كان أبيض سيبدو رائعاً هنا، وإلا استخدمنا أيقونة مؤقتة) */}
            <div className="flex items-center gap-3 mb-16">
              <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm border border-white/20">
                <Server className="text-[#F37920]" size={24} />
              </div>
              <span className="text-white font-black text-xl tracking-widest uppercase">FGS Solutions</span>
            </div>

            <h1 className="text-4xl font-black text-white leading-[1.15] tracking-tight mb-5">
              Intelligent <br/>
              Automation <br/>
              <span className="text-[#F37920]">Control Room</span>
            </h1>
            <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-[280px]">
              Securely monitor, manage, and scale your digital workforce across the enterprise with real-time telemetry.
            </p>
          </div>

          {/* شريط الأمان السفلي */}
          <div className="relative z-10 flex items-center gap-3 text-indigo-300/80 text-xs font-bold uppercase tracking-widest">
            <Shield size={16} />
            <span>Bank-Grade Security</span>
          </div>
        </div>

        {/* النصف الأيمن - نموذج تسجيل الدخول النظيف (Clean Form) */}
        <div className="w-full md:w-7/12 p-10 sm:p-16 lg:p-20 flex flex-col justify-center bg-white relative">

          <div className="mb-10">
            <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2">Sign In</h2>
            <p className="text-slate-500 font-semibold text-sm">Access your personalized CoE workspace.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">

            {/* رسالة الخطأ بشكل أنيق ومحترف */}
            {loginError && (
              <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-bold border border-red-100 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></div>
                {loginError}
              </div>
            )}

            {/* حقل اسم المستخدم */}
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Username</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User size={18} className="text-slate-300" />
                </div>
                <input
                  type="text"
                  required
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({...loginForm, username: e.target.value})}
                  className="w-full bg-slate-50/50 border border-slate-200 pl-11 pr-4 py-3.5 rounded-2xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:bg-white focus:ring-4 focus:ring-[#4B367C]/10 transition-all"
                  placeholder="Enter your AD username"
                />
              </div>
            </div>

            {/* حقل كلمة المرور */}
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock size={18} className="text-slate-300" />
                </div>
                <input
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
                  className="w-full bg-slate-50/50 border border-slate-200 pl-11 pr-4 py-3.5 rounded-2xl font-bold text-slate-800 focus:outline-none focus:border-[#4B367C] focus:bg-white focus:ring-4 focus:ring-[#4B367C]/10 transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* زر الدخول (Solid & Premium) */}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-[#4B367C] text-white font-black py-4 rounded-2xl hover:bg-[#3a2566] transition-all flex justify-center items-center gap-2 mt-4 shadow-[0_8px_20px_-6px_rgba(75,54,124,0.4)] hover:shadow-[0_12px_25px_-6px_rgba(75,54,124,0.5)] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? (
                <Activity size={20} className="animate-spin" />
              ) : (
                <>
                  Access Dashboard <ArrowRight size={18} />
                </>
              )}
            </button>

          </form>

          {/* تذييل الشاشة */}
          <div className="mt-12 pt-8 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-400">
            <span>© 2026 FGS Solutions. All rights reserved.</span>
            <span>v2.1.0</span>
          </div>

        </div>
      </div>
    </div>
  );
}