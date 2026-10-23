import { useEffect, useRef, useState } from 'react';
import { ORDER_FIELD_LABELS, reconcileOrder } from '../orderConflict';

export default function OrderConflictPanel({ original, draft, conflict, onResolve, onReload, busy }) {
  const [choices, setChoices] = useState({});
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [conflict.checked]);
  if (!conflict.checked) return (
    <section className="order-conflict" aria-label="최신 주문 확인">
      <h3 ref={heading} tabIndex={-1}>작성 내용은 보존되어 있습니다</h3>
      <p>최신 주문을 확인해야 편집을 계속할 수 있습니다.</p>
      <button type="button" className="order-form__button order-form__button--secondary" onClick={onReload} disabled={busy}>최신 주문 다시 확인</button>
    </section>
  );
  if (!conflict.latest) return (
    <section className="order-conflict" aria-label="삭제된 주문 확인">
      <h3 ref={heading} tabIndex={-1}>현재 목록에 이 주문이 없습니다</h3>
      {conflict.actionError && <p role="alert">{conflict.actionError}</p>}
      {conflict.requiresAck && <p>이전 요청의 최종 결과는 확정할 수 없습니다. 현재 목록을 확인했다는 의미로 아래 버튼을 눌러주세요.</p>}
      <p>자동으로 다시 등록하지 않습니다. 아래 작성 내용은 닫기 전까지 확인할 수 있습니다.</p>
      <button type="button" className="order-form__button order-form__button--secondary" onClick={() => onResolve(null)} disabled={busy}>확인 후 편집 닫기</button>
    </section>
  );
  const plan = reconcileOrder(original, draft, conflict.latest, choices);
  const changed = Object.keys(ORDER_FIELD_LABELS).filter(field => original[field] !== conflict.latest[field]);
  return (
    <section className="order-conflict" aria-label="주문 변경 내용 비교">
      <h3 ref={heading} tabIndex={-1}>{conflict.requiresAck ? '현재 주문과 작성 내용을 확인해주세요' : '현재 주문 상태를 확인해주세요'}</h3>
      {conflict.actionError && <p role="alert">{conflict.actionError}</p>}
      <p>{conflict.requiresAck ? '이전 요청의 최종 결과는 확인 범위를 지났습니다. 아래 내용을 확인한 뒤 편집을 계속할 수 있습니다.' : '작성 내용은 유지됩니다. 양쪽에서 같은 항목을 바꿨다면 사용할 값을 선택해주세요.'}</p>
      {changed.length === 0 && <p>현재 주문 내용은 처음 편집을 시작했을 때와 같습니다. 작성 내용을 유지한 채 편집을 계속할 수 있습니다.</p>}
      {changed.map(field => (
        <fieldset key={field} className="order-conflict__field" disabled={busy}>
          <legend>{ORDER_FIELD_LABELS[field]}</legend>
          {plan.conflicts.includes(field) ? ['latest', 'draft'].map(source => (
            <label key={source}>
              <input type="radio" name={`conflict-${field}`} checked={choices[field] === source} onChange={() => setChoices(previous => ({ ...previous, [field]: source }))} />
              <span><strong>{source === 'latest' ? '현재 주문' : '내 작성 내용'}</strong><span className="order-conflict__value">{(source === 'latest' ? conflict.latest[field] : draft[field]) || '(비어 있음)'}</span></span>
            </label>
          )) : <p className="order-conflict__value">현재 주문: {conflict.latest[field] || '(비어 있음)'}</p>}
        </fieldset>
      ))}
      <p>계속하기는 저장이 아닙니다. 내용을 확인한 후 ‘변경사항 저장’을 눌러주세요.</p>
      <button type="button" className="order-form__button order-form__button--primary" onClick={() => onResolve(plan.merged)} disabled={busy || !plan.ready}>확인 후 편집 계속</button>
    </section>
  );
}
