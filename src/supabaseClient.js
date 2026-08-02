import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. Please check your .env or Cloudflare settings.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // 세션을 localStorage에 저장
    autoRefreshToken: true,     // Access Token 만료 전 자동 갱신
    detectSessionInUrl: true,   // URL 해시에서 세션 감지 (OAuth 등)
    storageKey: 'myorder-auth-v1', // 고유 키로 다른 Supabase 프로젝트와 충돌 방지
  }
});
