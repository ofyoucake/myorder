import { useEffect, useId, useRef, useState } from 'react';
import './OrderFormModal.css';

const FIELD_META = {
  design: { label: '디자인', optionKey: 'design' },
  flavor: { label: '맛 선택', optionKey: 'flavor' },
  sheet: { label: '시트', optionKey: 'sheet' },
  size: { label: '사이즈', optionKey: 'size' },
  cream: { label: '크림', optionKey: 'cream' },
  orderPath: { label: '주문 경로', optionKey: 'orderPath' },
};

const KST_TIME_ZONE = 'Asia/Seoul';
const toText = (value) => (value === null || value === undefined ? '' : String(value));

const normalizeDateForInput = (value) => {
  const raw = toText(value);
  if (!raw || raw === '-') return '';

  const match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return '';

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const normalizeDateForSave = (value) => toText(value).replace(/-/g, '.');

const getKstDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}.${values.month}.${values.day}`;
};

const getTodayDateForInput = (date = new Date()) => (
  normalizeDateForInput(getKstDateKey(date))
);

const splitPickupDateTime = (value, defaultDate, defaultTime = '') => {
  const raw = toText(value);
  const match = raw.match(/^(\d{4}[./-]\d{1,2}[./-]\d{1,2})(?:\s+(.+))?$/);

  return {
    date: normalizeDateForInput(match?.[1] || defaultDate),
    time: match?.[2]?.slice(0, 5) || defaultTime,
  };
};

const getInitialState = (initialOrder, defaultDate) => {
  const order = initialOrder || {};
  const pickupDefaultHtmlDate = normalizeDateForInput(defaultDate);
  const pickup = splitPickupDateTime(
    order.pickupDate,
    initialOrder ? '' : pickupDefaultHtmlDate,
    initialOrder ? '' : '12:00',
  );

  return {
    customer: toText(order.customer),
    design: toText(order.design),
    orderDate: initialOrder ? normalizeDateForInput(order.orderDate) : getTodayDateForInput(),
    pickupDate: pickup.date,
    pickupTime: pickup.time,
    flavor: toText(order.flavor),
    sheet: toText(order.sheet),
    size: toText(order.size),
    cream: toText(order.cream),
    requests: toText(order.requests),
    specialNotes: toText(order.specialNotes),
    orderPath: toText(order.orderPath),
  };
};

const normalizeOption = (option) => {
  if (typeof option === 'string' || typeof option === 'number') {
    return { value: String(option), label: String(option) };
  }

  if (option && typeof option === 'object') {
    const value = option.value ?? option.key ?? option.label ?? '';
    const label = option.label ?? option.value ?? option.key ?? '';
    return { value: String(value), label: String(label) };
  }

  return { value: '', label: '' };
};

const getFocusableElements = (container) => {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
};

const isValidDateInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return false;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const isValidTimeInput = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export default function OrderFormModal({
  initialOrder = null,
  defaultDate = '',
  options = {},
  onSave,
  onCancel,
  busy = false,
  pending = false,
  onRetry,
  error = '',
}) {
  const [form, setForm] = useState(() => getInitialState(initialOrder, defaultDate));
  const [errors, setErrors] = useState({});
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const pickupDateRef = useRef(null);
  const pickupTimeRef = useRef(null);
  const busyRef = useRef(busy || pending);
  const onCancelRef = useRef(onCancel);
  const titleId = `order-form-title-${useId().replace(/:/g, '')}`;
  const descriptionId = `${titleId}-description`;

  useEffect(() => {
    busyRef.current = busy || pending;
  }, [busy, pending]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previousActiveElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) onCancelRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement instanceof HTMLElement) previousActiveElement.focus();
    };
  }, []);

  const handleChange = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validate = () => {
    const nextErrors = {};

    if (!form.customer.trim()) nextErrors.customer = '고객명을 입력해주세요.';
    if (form.orderDate && !isValidDateInput(form.orderDate)) nextErrors.orderDate = '유효한 주문일자를 입력해주세요.';

    if ((!form.pickupDate || !form.pickupTime) && (!initialOrder || form.pickupDate)) {
      nextErrors.pickupDate = '픽업 날짜와 시간을 입력해주세요.';
    } else if (form.pickupDate && !isValidDateInput(form.pickupDate)) {
      nextErrors.pickupDate = '유효한 픽업 날짜를 입력해주세요.';
    } else if (form.pickupDate && !isValidTimeInput(form.pickupTime)) {
      nextErrors.pickupDate = '유효한 픽업 시간을 입력해주세요.';
    }

    setErrors(nextErrors);

    const pickupFocusTarget = !form.pickupDate || !isValidDateInput(form.pickupDate)
      ? pickupDateRef.current
      : pickupTimeRef.current;
    const focusTarget = nextErrors.customer
      ? firstFieldRef.current
      : nextErrors.orderDate
        ? document.getElementById('order-order-date')
        : nextErrors.pickupDate
          ? pickupFocusTarget
          : null;
    window.requestAnimationFrame(() => focusTarget?.focus());

    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy || !validate()) return;

    onSave?.({
      customer: form.customer,
      design: form.design,
      orderDate: normalizeDateForSave(form.orderDate),
      pickupDate: form.pickupDate ? `${normalizeDateForSave(form.pickupDate)} ${form.pickupTime}` : '',
      flavor: form.flavor,
      sheet: form.sheet,
      size: form.size,
      cream: form.cream,
      requests: form.requests,
      specialNotes: form.specialNotes,
      orderPath: form.orderPath,
    });
  };

  const renderError = (field) => (
    errors[field] ? (
      <p className="order-form__field-error" id={`order-error-${field}`} role="alert">
        {errors[field]}
      </p>
    ) : null
  );

  const renderDatalist = (field) => {
    const meta = FIELD_META[field];
    const values = (options[meta.optionKey] || []).map(normalizeOption).filter((option) => option.value);
    if (values.length === 0) return null;

    return (
      <datalist id={`order-options-${field}`}>
        {values.map((option, index) => (
          <option key={`${option.value}-${index}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    );
  };

  const closeFromOverlay = (event) => {
    if (event.target === event.currentTarget && !busy && !pending) onCancel?.();
  };

  return (
    <div className="order-form__overlay" onMouseDown={closeFromOverlay}>
      <section
        ref={dialogRef}
        className="order-form__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="order-form__header">
          <div>
            <h2 id={titleId}>{initialOrder ? '주문 수정' : '새 주문 등록'}</h2>
            <p id={descriptionId} className="order-form__description">
              주문서의 기본 정보를 입력해주세요.
            </p>
            {(busy || pending) && (
              <p className="order-form__description" role="status">
                저장 중에는 구글 시트에서 직접 편집하거나 정렬하지 마세요.
              </p>
            )}
            {pending && (
              <button
                className="order-form__button order-form__button--primary"
                type="button"
                onClick={onRetry}
                disabled={busy}
              >
                처리 결과 다시 확인
              </button>
            )}
          </div>
          <button
            className="order-form__close"
            type="button"
            aria-label="주문 입력 닫기"
            onClick={() => !busy && !pending && onCancel?.()}
            disabled={busy || pending}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <form className="order-form__body" onSubmit={handleSubmit} noValidate>
          <fieldset className="order-form__fieldset" disabled={busy || pending}>
            {error && <div className="order-form__form-error" role="alert">{error}</div>}

            <div className="order-form__section">
              <div className="order-form__section-heading">
              <div>
                <h3>고객 및 일정</h3>
                <p>고객명과 픽업 일정을 지정해주세요.</p>
              </div>
              </div>

              <div className="order-form__grid">
              <div className="order-form__field order-form__field--full">
                <label htmlFor="order-customer">고객명 <span aria-hidden="true">*</span></label>
                <input
                  ref={firstFieldRef}
                  id="order-customer"
                  type="text"
                  value={form.customer}
                  onChange={handleChange('customer')}
                  aria-invalid={Boolean(errors.customer)}
                  aria-describedby={errors.customer ? 'order-error-customer' : undefined}
                  autoComplete="name"
                  placeholder="고객명을 입력해주세요."
                />
                {renderError('customer')}
              </div>

                <div className="order-form__field">
                  <label htmlFor="order-order-date">주문일자</label>
                  <input id="order-order-date" type="date" min="1900-01-01" max="2100-12-31" value={form.orderDate} onChange={handleChange('orderDate')} aria-invalid={Boolean(errors.orderDate)} aria-describedby={errors.orderDate ? 'order-error-orderDate' : undefined} />
                  {renderError('orderDate')}
                </div>

                <div className="order-form__field order-form__field--pickup">
                  <label htmlFor="order-pickup-date">픽업일시 <span aria-hidden="true">*</span></label>
                  <div className="order-form__date-time">
                    <input
                      ref={pickupDateRef}
                      id="order-pickup-date"
                      type="date"
                      min="1900-01-01"
                      max="2100-12-31"
                      value={form.pickupDate}
                      onChange={handleChange('pickupDate')}
                      aria-invalid={Boolean(errors.pickupDate)}
                      aria-describedby={errors.pickupDate ? 'order-error-pickupDate' : undefined}
                    />
                    <input
                      ref={pickupTimeRef}
                      id="order-pickup-time"
                      type="time"
                      value={form.pickupTime}
                      onChange={handleChange('pickupTime')}
                      aria-label="픽업 시간"
                      aria-invalid={Boolean(errors.pickupDate)}
                      aria-describedby={errors.pickupDate ? 'order-error-pickupDate' : undefined}
                    />
                  </div>
                  {renderError('pickupDate')}
                </div>
              </div>
            </div>

            <div className="order-form__section">
              <div className="order-form__section-heading">
              <div>
                <h3>케이크 구성</h3>
                <p>기존 목록에서 선택하거나 새로운 값을 직접 입력할 수 있습니다.</p>
              </div>
              </div>

              <div className="order-form__grid">
              {['design', 'flavor', 'sheet', 'size', 'cream'].map((field) => {
                const meta = FIELD_META[field];
                return (
                  <div className="order-form__field" key={field}>
                    <label htmlFor={`order-${field}`}>{meta.label}</label>
                    <input
                      id={`order-${field}`}
                      type="text"
                      list={`order-options-${field}`}
                      value={form[field]}
                      onChange={handleChange(field)}
                      placeholder={`${meta.label} 입력`}
                    />
                    {renderDatalist(field)}
                  </div>
                );
              })}
              </div>
            </div>

            <div className="order-form__section">
              <div className="order-form__section-heading">
              <div>
                <h3>요청사항 및 경로</h3>
                <p>원문 공백과 줄바꿈을 그대로 유지해 저장합니다.</p>
              </div>
              </div>

              <div className="order-form__grid">
              <div className="order-form__field order-form__field--full">
                <label htmlFor="order-requests">요청사항</label>
                <textarea id="order-requests" rows="3" value={form.requests} onChange={handleChange('requests')} placeholder="고객 요청사항을 입력해주세요." />
              </div>
              <div className="order-form__field order-form__field--full">
                <label htmlFor="order-special-notes">특이사항</label>
                <textarea id="order-special-notes" rows="3" value={form.specialNotes} onChange={handleChange('specialNotes')} placeholder="제작 또는 픽업 시 참고할 내용을 입력해주세요." />
              </div>
              <div className="order-form__field">
                <label htmlFor="order-order-path">주문 경로</label>
                <input
                  id="order-order-path"
                  type="text"
                  list="order-options-orderPath"
                  value={form.orderPath}
                  onChange={handleChange('orderPath')}
                  placeholder="주문 경로 입력"
                />
                {renderDatalist('orderPath')}
              </div>
              </div>
            </div>

            <div className="order-form__footer">
              <p className="order-form__required-note"><span aria-hidden="true">*</span> 필수 입력 항목</p>
              <div className="order-form__actions">
                <button className="order-form__button order-form__button--secondary" type="button" onClick={() => onCancel?.()} disabled={busy || pending}>
                  취소
                </button>
                <button className="order-form__button order-form__button--primary" type="submit">
                  {busy ? '저장 중...' : pending ? '입력 잠금됨' : initialOrder ? '변경사항 저장' : '주문 등록'}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
