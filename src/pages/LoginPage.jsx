import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { supabase } from '../supabaseClient';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert('회원가입 성공! 로그인을 진행해주세요.');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-main)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '40px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '28px', fontWeight: '800', color: 'var(--point)', marginBottom: '12px' }}>MyOrder</h2>
        <p style={{ color: 'var(--text-sub)', marginBottom: '32px' }}>
          {isSignUp ? '간편하게 가입하고 매장을 관리하세요.' : '다시 오신 것을 환영합니다.'}
        </p>
        
        <form onSubmit={handleAuth} className="flex flex-col gap-md">
          <Input 
            label="이메일" 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="example@email.com" 
            required
          />
          <Input 
            label="비밀번호" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="••••••••" 
            required
          />
          
          {error && <p style={{ color: 'var(--error)', fontSize: '13px', textAlign: 'left' }}>{error}</p>}
          
          <Button type="submit" size="large" style={{ marginTop: '12px' }} disabled={loading}>
            {loading ? '처리 중...' : (isSignUp ? '회원가입' : '로그인')}
          </Button>
        </form>
        
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--line)' }}>
          <p style={{ fontSize: '14px', color: 'var(--text-sub)' }}>
            {isSignUp ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'}
            <button 
              onClick={() => setIsSignUp(!isSignUp)}
              style={{ marginLeft: '8px', color: 'var(--point)', fontWeight: '700', border: 'none', background: 'none', cursor: 'pointer' }}
            >
              {isSignUp ? '로그인하기' : '회원가입하기'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
