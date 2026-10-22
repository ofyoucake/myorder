import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import './ConnectionTestPage.css';
const ERROR_COPY = {
  AUTH_REQUIRED: '로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.',
  FORBIDDEN: '읽기 전용 연결 확인 권한이 없습니다.',
  SERVICE_UNAVAILABLE: '연결 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
};
const DIAGNOSTIC_COPY = {
  CONFIG_INVALID: '등록된 서비스 계정 JSON의 형식 또는 계정이 설정과 다릅니다.',
  TOKEN_EXCHANGE_FAILED: '구글 서비스 계정 인증이 거부되었습니다.',
  SHEETS_FORBIDDEN: '서비스 계정의 시트 접근 권한 또는 Sheets API 설정을 확인해야 합니다.',
  SHEETS_NOT_FOUND: '설정된 운영 스프레드시트를 찾을 수 없습니다.',
  RANGE_NOT_ALLOWED: '시트 조회 범위가 안전 제한과 맞지 않습니다.',
  FIELDS_NOT_ALLOWED: '시트 조회 항목이 안전 제한과 맞지 않습니다.',
  RESPONSE_TOO_LARGE: '시트 응답이 안전 크기 제한을 초과했습니다.',
  TIMEOUT: '구글 응답 대기 시간이 초과되었습니다.',
  SERVER_AUTH_UNAVAILABLE: '서버의 관리자 계정 설정 또는 Supabase 인증 연결을 확인해야 합니다.',
  SHEET_STRUCTURE_UNEXPECTED: '운영 탭의 이름, 행 수 또는 응답 구조를 확인해야 합니다.',
  SHEETS_REQUEST_FAILED: '구글이 시트 조회 요청 형식을 거부했습니다.',
  SHEETS_UNAUTHORIZED: '구글이 시트 조회 인증을 거부했습니다.',
  SHEETS_RATE_LIMITED: '구글 시트 요청 한도에 도달했습니다.',
  SHEETS_UPSTREAM_ERROR: '구글 시트 서버에 일시적인 오류가 있습니다.',
  RESPONSE_INVALID: '구글 응답이 예상한 JSON 형식이 아닙니다.',
  TOKEN_RESPONSE_INVALID: '구글 인증 응답의 형식이 예상과 다릅니다.',
  SPREADSHEET_NOT_ALLOWED: '시트 ID가 서버 허용 목록과 일치하지 않습니다.',
  NETWORK_ERROR: '서버에서 구글에 연결하지 못했습니다.',
};
const getErrorCode = (status, code) => {
  if (status === 401 || code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  if (status === 403 || code === 'FORBIDDEN') return 'FORBIDDEN';
  return 'SERVICE_UNAVAILABLE';
};
const isNonNegativeNumber = (value) => Number.isFinite(value) && value >= 0;
const isValidConnectionResult = (value) => {
  if (!value || typeof value !== 'object') return false;

  return (
    value.connected === true &&
    value.readOnly === true &&
    typeof value.timeZone === 'string' &&
    isNonNegativeNumber(value.orderCount) &&
    (value.lastOrderRow === null || isNonNegativeNumber(value.lastOrderRow)) &&
    isNonNegativeNumber(value.missingIdCount) &&
    isNonNegativeNumber(value.duplicateIdCount) &&
    isNonNegativeNumber(value.existingLegacyLValueCount) &&
    typeof value.idHeaderReady === 'boolean' &&
    (value.fingerprint === undefined || value.fingerprint === null || typeof value.fingerprint === 'string')
  );
};
const TEST_ERROR_COPY = {
  AUTH_REQUIRED: '로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.',
  FORBIDDEN: '실제 쓰기 검증이 잠겨 있거나 권한이 없습니다.',
  SERVICE_UNAVAILABLE: '쓰기 검증 결과를 확인할 수 없습니다. 테스트 전용 문서의 정리 상태를 확인하기 전에는 다시 시도하지 마세요.',
};
const isValidIsolatedTestResult = (value) => (
  value &&
  typeof value === 'object' &&
  typeof value.passed === 'boolean' &&
  typeof value.cleanedUp === 'boolean' &&
  Array.isArray(value.checks) &&
  value.checks.every((check) => typeof check === 'string') &&
  typeof value.productionUnchanged === 'boolean' &&
  isNonNegativeNumber(value.productionOrderCount)
);
export default function ConnectionTestPage({ session }) {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [errorCode, setErrorCode] = useState('');
  const [diagnosticCode, setDiagnosticCode] = useState('');
  const [testStatus, setTestStatus] = useState('idle');
  const [testResult, setTestResult] = useState(null);
  const [testErrorCode, setTestErrorCode] = useState('');
  const [testState, setTestState] = useState(null);
  const testBusyRef = useRef(false);
  const handleConnectionTest = async () => {
    if (testBusyRef.current) return;
    setStatus('loading');
    setResult(null);
    setErrorCode('');
    setDiagnosticCode('');
    setTestStatus('idle');
    setTestResult(null);
    setTestErrorCode('');

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const currentSession = data?.session;

      if (
        sessionError ||
        !currentSession?.access_token ||
        (session?.user?.id && currentSession.user?.id !== session.user.id)
      ) {
        setErrorCode('AUTH_REQUIRED');
        setStatus('error');
        return;
      }

      const response = await fetch('/api/orders/connection', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${currentSession.access_token}`,
        },
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorCode(getErrorCode(response.status, payload?.error?.code));
        if (Object.hasOwn(DIAGNOSTIC_COPY, payload?.error?.diagnosticCode)) setDiagnosticCode(payload.error.diagnosticCode);
        setStatus('error');
        return;
      }

      if (!isValidConnectionResult(payload)) {
        setErrorCode('SERVICE_UNAVAILABLE');
        setStatus('error');
        return;
      }

      setResult(payload);
      setStatus('success');
      const inspection = await fetch('/api/orders/isolated-test', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${currentSession.access_token}` }, cache: 'no-store',
      });
      const state = await inspection.json().catch(() => null);
      if (inspection.ok && state?.readOnly === true && typeof state.testDocument === 'boolean'
        && typeof state.lockPresent === 'boolean' && Number.isSafeInteger(state.occupiedTestRows)) setTestState(state);
    } catch {
      setErrorCode('SERVICE_UNAVAILABLE');
      setStatus('error');
    }
  };

  const handleIsolatedTest = async () => {
    if (testBusyRef.current || status !== 'success') return;
    testBusyRef.current = true;
    setTestStatus('loading');
    setTestResult(null);
    setTestErrorCode('');

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const currentSession = data?.session;

      if (
        sessionError ||
        !currentSession?.access_token ||
        (session?.user?.id && currentSession.user?.id !== session.user.id)
      ) {
        setTestErrorCode('AUTH_REQUIRED');
        setTestStatus('error');
        return;
      }

      const response = await fetch('/api/orders/isolated-test', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${currentSession.access_token}`,
        },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setTestErrorCode(getErrorCode(response.status, payload?.error?.code || payload?.code));
        setTestStatus('error');
        return;
      }

      if (!isValidIsolatedTestResult(payload)) {
        setTestErrorCode('SERVICE_UNAVAILABLE');
        setTestStatus('error');
        return;
      }

      setTestResult(payload);
      setTestStatus(payload.passed && payload.cleanedUp && payload.productionUnchanged ? 'success' : 'warning');
    } catch {
      setTestErrorCode('SERVICE_UNAVAILABLE');
      setTestStatus('error');
    } finally {
      testBusyRef.current = false;
    }
  };

  const isLoading = status === 'loading';
  const testBusy = testStatus === 'loading';
  const errorMessage = errorCode ? ERROR_COPY[errorCode] : '';
  const testErrorMessage = testErrorCode ? TEST_ERROR_COPY[testErrorCode] : '';
  const preventNavigationDuringTest = (event) => {
    if (testBusy) event.preventDefault();
  };
  return (
    <main className="connection-test-page">
      <section className="connection-test-card" aria-labelledby="connection-test-title">
        <div className="connection-test-heading">
          <div>
            <p className="connection-test-kicker">운영 점검</p>
            <h1 id="connection-test-title">주문 연결 확인</h1>
            <p className="connection-test-description">
              운영 예약은 읽기 전용으로만 확인합니다. 쓰기 검증은 별도 [테스트 전용·제작 금지] 문서에서만 테스트 데이터를 등록·수정·삭제하고 정리합니다.
            </p>
          </div>
          <span className="connection-test-badge">운영 READ ONLY</span>
        </div>

        <div className="connection-test-notice" role="note">
          <span className="connection-test-notice-mark" aria-hidden="true">✓</span>
          <div>
            <strong>안전한 점검 모드</strong>
              <p>운영 시트에는 쓰지 않습니다. 별도 [테스트 전용·제작 금지] 문서의 쓰기 검증에서만 테스트 데이터를 사용하며, 토큰과 원문 서버 오류는 화면에 표시하지 않습니다.</p>
          </div>
        </div>

        <div className="connection-test-actions">
          <button
            className="connection-test-button"
            type="button"
            onClick={handleConnectionTest}
            disabled={isLoading || testBusy}
            aria-busy={isLoading}
          >
            {isLoading ? '연결 확인 중...' : '읽기 전용 연결 확인'}
          </button>
          <a
            className="connection-test-back"
            href={testBusy ? undefined : '/'}
            aria-disabled={testBusy}
            tabIndex={testBusy ? -1 : undefined}
            onClick={preventNavigationDuringTest}
          >
            {testBusy ? '쓰기 검증 진행 중...' : '대시보드로 돌아가기'}
          </a>
        </div>

        <div className="connection-test-output" aria-live="polite">
          {status === 'idle' && (
            <div className="connection-test-empty">
              <span aria-hidden="true">↗</span>
              <p>버튼을 누르면 현재 로그인 세션으로 운영 연결을 확인합니다.</p>
            </div>
          )}

          {status === 'loading' && (
            <div className="connection-test-loading" role="status">
              <span className="connection-test-spinner" aria-hidden="true" />
              <p>읽기 전용 연결을 확인하고 있습니다.</p>
            </div>
          )}

          {status === 'error' && (
            <div className="connection-test-error" role="alert">
              <span className="connection-test-error-code">{errorCode}</span>
              <p>{errorMessage}</p>
              {diagnosticCode && <p>{diagnosticCode}: {DIAGNOSTIC_COPY[diagnosticCode]}</p>}
            </div>
          )}

          {status === 'success' && result && (
            <div className="connection-test-success">
              <div className="connection-test-success-header">
                <div>
                  <span className="connection-test-success-dot" aria-hidden="true" />
                  <strong>연결 확인 완료</strong>
                </div>
                <span className="connection-test-timezone">{result.timeZone}</span>
              </div>

              <p className="connection-test-summary">
                운영 시트: 읽기 전용 / 운영 예약 변경 없음 / 쓰기 검증은 별도 테스트 문서에서만 수행
              </p>

              <dl className="connection-test-metrics">
                <div>
                  <dt>주문 수</dt>
                  <dd>{result.orderCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>마지막 주문 행</dt>
                  <dd>{result.lastOrderRow === null ? '—' : result.lastOrderRow.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>ID 누락</dt>
                  <dd>{result.missingIdCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>ID 중복</dt>
                  <dd>{result.duplicateIdCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>기존 L값</dt>
                  <dd>{result.existingLegacyLValueCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>ID 헤더</dt>
                  <dd>{result.idHeaderReady ? '준비됨' : '미준비'}</dd>
                </div>
              </dl>

              {result.fingerprint && (
                <p className="connection-test-fingerprint" title={result.fingerprint}>
                  fingerprint <span>{result.fingerprint}</span>
                </p>
              )}

              <div className="connection-test-notice connection-test-isolated" role="note">
                <div>
                  {testState && <p>테스트 문서 확인: {testState.testDocument ? '대상 일치' : '대상 불일치'} / 잔여 데이터 {testState.occupiedTestRows}행 / 잠금 {testState.lockPresent ? '있음 — 재실행 금지' : '없음'}</p>}
                  <p>
                  운영 예약은 읽기 전용으로 보호합니다. 별도 [테스트 전용·제작 금지] 문서에서만 테스트 데이터의 등록·수정·삭제를 실제로 검증하고 정리합니다.
                  </p>
                  <button
                    className="connection-test-button"
                    type="button"
                    onClick={handleIsolatedTest}
                    disabled={isLoading || testBusy}
                    aria-busy={testBusy}
                    style={{ background: 'var(--bg-card)', color: 'var(--point-dark)', borderColor: 'var(--point-light)', boxShadow: 'none' }}
                  >
                    {testBusy ? '쓰기 검증 중...' : '테스트 전용 시트에서 쓰기 검증'}
                  </button>
                </div>
              </div>

              {testStatus === 'loading' && (
                <div className="connection-test-loading" role="status">
                  <span className="connection-test-spinner" aria-hidden="true" />
                  <p>테스트 전용 문서의 등록·수정·삭제를 검증하고 있습니다.</p>
                </div>
              )}

              {testStatus === 'error' && (
                <div className="connection-test-error" role="alert">
                  <span className="connection-test-error-code">{testErrorCode}</span>
                  <p>{testErrorMessage}</p>
                </div>
              )}

              {testStatus === 'success' && testResult && (
                <div className="connection-test-success" role="status">
                  <p className="connection-test-summary">검증 통과 / 테스트 데이터 정리 완료 / 운영 주문 {testResult.productionOrderCount.toLocaleString()}건 변경 없음</p>
                </div>
              )}

              {testStatus === 'warning' && testResult && (
                <div className="connection-test-error" role="alert">
                  <span className="connection-test-error-code">{testResult.productionUnchanged ? 'TEST_VALIDATION_FAILED' : 'PRODUCTION_UNCHANGED_FALSE'}</span>
                  <p>
                    {testResult.productionUnchanged
                      ? `쓰기 검증이 완료 기준을 충족하지 않았습니다. 운영 주문 ${testResult.productionOrderCount.toLocaleString()}건 변경 없음.`
                      : '운영 주문 변경 감지가 독립 실패로 판정되었습니다. 즉시 점검을 중단해주세요.'}
                    {' 테스트 전용 문서의 정리 상태를 확인하기 전에는 다시 시도하지 마세요.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
