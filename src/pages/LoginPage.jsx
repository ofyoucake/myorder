import React from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

const LoginPage = ({ onLogin }) => {
  return (
    <div className="login-bg">
      <div className="card" style={{ 
        width: '100%', 
        maxWidth: '440px', 
        padding: '64px 48px',
        display: 'flex',
        flexDirection: 'column',
        gap: '48px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.05)',
        border: 'none',
        borderRadius: '24px',
        backgroundColor: 'var(--bg-card)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '64px', height: '64px', backgroundColor: 'var(--point)', borderRadius: '14px', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            color: 'white', fontWeight: '900', fontSize: '32px', margin: '0 auto 24px',
          }}>M</div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: 'var(--point)', letterSpacing: '-0.04em' }}>MyOrder</h1>
          <p style={{ color: 'var(--text-sub)', fontSize: '16px', marginTop: '12px', fontWeight: '500' }}>
            매장 운영의 새로운 기준<br />관리자 계정으로 로그인하세요.
          </p>
        </div>

        <div className="flex flex-col gap-md">
          <Input label="이메일 주소" type="email" placeholder="admin@myorder.com" />
          <Input label="비밀번호" type="password" placeholder="••••••••" />
          
          <div className="flex flex-col gap-md" style={{ marginTop: '24px' }}>
            <Button 
              onClick={onLogin} 
              size="large"
              style={{ width: '100%' }}
            >
              로그인하기
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '8px 0' }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--line)' }}></div>
              <span style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: '700' }}>OR</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--line)' }}></div>
            </div>
            <Button 
              variant="secondary" 
              size="large"
              style={{ width: '100%' }}
            >
              신규 계정 신청
            </Button>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <a href="#" style={{ color: 'var(--text-sub)', fontSize: '14px', textDecoration: 'none', fontWeight: '600' }}>
            계정 정보를 잊으셨나요?
          </a>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
