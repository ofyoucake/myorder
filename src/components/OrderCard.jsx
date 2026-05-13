import React from 'react';

export const OrderCard = ({ time, customer, items, color, onClick }) => {
  return (
    <div 
      onClick={onClick}
      className="card" 
      style={{ 
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        border: 'none',
        borderLeft: `4px solid ${color || 'var(--point)'}`,
        backgroundColor: 'var(--bg-card)',
        // Hover effect for interactivity
        transform: 'translateY(0)',
        boxShadow: 'none', // Remove flat shadow to match design.md
        border: '1px solid var(--line)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-elevation)';
        e.currentTarget.style.borderColor = 'transparent';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.border = '1px solid var(--line)';
        e.currentTarget.style.borderLeft = `4px solid ${color || 'var(--point)'}`;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ 
          fontSize: '13px', 
          fontWeight: '800', 
          color: color || 'var(--point)',
          backgroundColor: `${color}15` || 'var(--point-light)',
          padding: '4px 8px',
          borderRadius: '6px',
          minWidth: '55px',
          textAlign: 'center'
        }}>
          {time}
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>
            {customer}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-sub)', marginTop: '2px', fontWeight: '500' }}>
            {items.join(', ')}
          </div>
        </div>
      </div>
      <div style={{ color: 'var(--line)', fontSize: '18px' }}>→</div>
    </div>
  );
};
