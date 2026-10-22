import { useState } from 'react';
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

export default function ConnectionTestPage({ session }) {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [errorCode, setErrorCode] = useState('');
  const [diagnosticCode, setDiagnosticCode] = useState('');

  const handleConnectionTest = async () => {
    setStatus('loading');
    setResult(null);
    setErrorCode('');
    setDiagnosticCode('');

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
    } catch {
      setErrorCode('SERVICE_UNAVAILABLE');
      setStatus('error');
    }
  };

  const isLoading = status === 'loading';
  const errorMessage = errorCode ? ERROR_COPY[errorCode] : '';

  return (
    <main className="connection-test-page">
      <section className="connection-test-card" aria-labelledby="connection-test-title">
        <div className="connection-test-heading">
          <div>
            <p className="connection-test-kicker">운영 점검</p>
            <h1 id="connection-test-title">주문 연결 확인</h1>
            <p className="connection-test-description">
              운영 주문 연결 상태만 확인합니다. 이 화면에서는 예약 데이터를 변경하거나 추가하지 않습니다.
            </p>
          </div>
          <span className="connection-test-badge">READ ONLY</span>
        </div>

        <div className="connection-test-notice" role="note">
          <span className="connection-test-notice-mark" aria-hidden="true">✓</span>
          <div>
            <strong>안전한 점검 모드</strong>
            <p>인증된 세션으로 읽기 전용 연결만 확인하며, 토큰과 원문 서버 오류는 화면에 표시하지 않습니다.</p>
          </div>
        </div>

        <div className="connection-test-actions">
          <button
            className="connection-test-button"
            type="button"
            onClick={handleConnectionTest}
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '연결 확인 중...' : '읽기 전용 연결 확인'}
          </button>
          <a className="connection-test-back" href="/">대시보드로 돌아가기</a>
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
                운영 시트: 읽기 전용 / 예약 변경 없음 / 테스트 예약 추가 없음
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
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
