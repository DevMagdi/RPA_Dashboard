import React, { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [userRole, setUserRole] = useState(localStorage.getItem('role') || null);
  const [userName, setUserName] = useState(localStorage.getItem('username') || null);

  const handleLoginSuccess = (newToken, newRole, newUsername) => {
    setToken(newToken);
    setUserRole(newRole);
    setUserName(newUsername);
    localStorage.setItem('token', newToken);
    localStorage.setItem('role', newRole);
    localStorage.setItem('username', newUsername);
  };

  const handleLogout = () => {
    setToken(null);
    setUserRole(null);
    setUserName(null);
    localStorage.clear();
  };

  // إذا لم يكن مسجلاً، اظهر شاشة الدخول الفخمة
  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // إذا كان مسجلاً، اعرض الداشبورد ومرر لها بيانات الصلاحيات
  return (
    <Dashboard
      token={token}
      userRole={userRole}
      userName={userName}
      onLogout={handleLogout}
    />
  );
}