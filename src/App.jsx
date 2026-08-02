import React, { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import { supabase } from './supabaseClient';
import './index.css';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // iOS Safari 대응: 앱이 백그라운드 → 포그라운드로 돌아올 때 세션 재확인
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (loading) {
    return <div className="loading-container">연동 중...</div>;
  }

  return (
    <div className="app-container">
      {session ? (
        <DashboardPage session={session} onLogout={() => supabase.auth.signOut()} />
      ) : (
        <LoginPage />
      )}
    </div>
  );
}

export default App;
