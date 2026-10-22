// Local preview only. Never imported by the production Vite configuration.
const session = { user: { id: 'preview-user', email: '미리보기 · 테스트 데이터' }, access_token: 'local-preview-only' };
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}),
  },
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { sheet_url: 'local-preview-source' } }) }) }),
    upsert: async () => ({ error: { message: '미리보기에서는 계정 설정을 저장하지 않습니다.' } }),
  }),
};
