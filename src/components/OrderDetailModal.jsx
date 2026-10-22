import { useEffect, useId, useRef } from 'react';
import './OrderDialogs.css';

export function OrderDialog({ children, title, onClose, busy = false, compact = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    const dialog = ref.current;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`order-dialog${compact ? ' order-dialog--compact' : ''}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    >
      <header className="order-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="order-dialog__close" aria-label="닫기" onClick={onClose} disabled={busy}>×</button>
      </header>
      {children}
    </dialog>
  );
}

const DetailField = ({ label, children }) => (
  <div className="order-detail__field">
    <dt>{label}</dt>
    <dd>{children || '-'}</dd>
  </div>
);

export default function OrderDetailModal({ order, onClose, onCopy, copiedType, onEdit, onDelete, editable }) {
  return (
    <OrderDialog title="주문 상세 내역" onClose={onClose}>
      <div className="order-dialog__body">
        <div className="order-detail__grid">
          <section className="order-detail__section">
            <h3>기본 정보</h3>
            <dl className="order-detail__fields">
              <DetailField label="고객명">{order.customer}</DetailField>
              <DetailField label="주문일자">{order.orderDate}</DetailField>
              <DetailField label="픽업일시">{order.pickupDate}</DetailField>
              <DetailField label="주문경로">{order.orderPath}</DetailField>
            </dl>
          </section>
          <section className="order-detail__section order-detail__section--cake">
            <h3>케이크 정보</h3>
            <dl className="order-detail__fields">
              <DetailField label="디자인">{order.design}</DetailField>
              <DetailField label="맛 선택">{order.flavor}</DetailField>
              <DetailField label="시트">{order.sheet}</DetailField>
              <DetailField label="사이즈">{order.size}</DetailField>
              <DetailField label="크림">{order.cream}</DetailField>
              <DetailField label="가격">{order.price.toLocaleString()}원</DetailField>
            </dl>
            <dl className="order-detail__notes">
              <DetailField label="요청/특이사항">{[order.requests, order.specialNotes].filter((value) => value && value !== '-').join(' / ')}</DetailField>
            </dl>
          </section>
        </div>
        <section className="order-detail__messages" aria-label="메시지 복사">
          <h3>메시지 복사</h3>
          <div className="order-detail__message-grid">
            {[
              { type: 'order', label: '📄 주문서' },
              { type: 'reservation', label: '✅ 예약확정' },
              { type: 'pickup', label: '🚗 픽업안내' },
              { type: 'unmanned', label: '🔓 무인픽업안내' },
            ].map(({ type, label }) => (
              <button key={type} type="button" className={`order-detail__message${copiedType === type ? ' is-copied' : ''}`} onClick={() => onCopy(type, order)}>
                {copiedType === type ? '✓ 복사됨!' : label}
              </button>
            ))}
          </div>
          <span className="order-dialog__sr-only" role="status">{copiedType ? '메시지가 복사되었습니다.' : ''}</span>
        </section>
      </div>
      <footer className="order-dialog__footer">
        {editable && <button type="button" className="order-dialog__button order-dialog__button--danger" onClick={onDelete}>삭제</button>}
        <div className="order-dialog__footer-actions">
          <button type="button" className="order-dialog__button" onClick={onClose}>닫기</button>
          {editable && <button type="button" className="order-dialog__button order-dialog__button--primary" onClick={onEdit}>편집</button>}
        </div>
      </footer>
    </OrderDialog>
  );
}

export function OrderDeleteModal({ order, onClose, onDelete, onRetry, busy, pending = false, error }) {
  return (
    <OrderDialog title="주문을 삭제할까요?" onClose={onClose} busy={busy || pending} compact>
      <div className="order-dialog__body">
        <p className="order-delete__description">삭제하면 홈페이지와 연결된 시트에서 이 주문이 제거됩니다. 삭제 후에는 되돌릴 수 없습니다.</p>
        <dl className="order-delete__summary">
          <DetailField label="고객명">{order.customer}</DetailField>
          <DetailField label="픽업일시">{order.pickupDate}</DetailField>
          <DetailField label="디자인">{order.design}</DetailField>
        </dl>
        {error && <p className="order-dialog__error" role="alert">{error}</p>}
      </div>
      <footer className="order-dialog__footer">
        <button type="button" className="order-dialog__button" onClick={onClose} disabled={busy || pending} autoFocus>취소</button>
        <button
          type="button"
          className="order-dialog__button order-dialog__button--destructive"
          onClick={pending ? onRetry : onDelete}
          disabled={busy}
        >
          {busy ? '삭제 중...' : pending ? '처리 결과 다시 확인' : '주문 삭제'}
        </button>
      </footer>
    </OrderDialog>
  );
}
