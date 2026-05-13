import React, { useState } from 'react';

export const Input = ({ label, type = 'text', placeholder, ...props }) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="flex flex-col gap-sm" style={{ width: '100%' }}>
      {label && <label style={{ 
        fontSize: '13px', 
        fontWeight: '600', 
        color: 'var(--text-sub)',
        paddingLeft: '4px'
      }}>{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          width: '100%',
          height: '44px',
          padding: '0 16px',
          backgroundColor: 'var(--bg-main)',
          border: isFocused ? '1px solid var(--point)' : '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '14px',
          color: 'var(--text-main)',
          boxShadow: isFocused ? '0 0 0 3px var(--point-light)' : 'none',
          transition: 'all 0.2s ease',
        }}
        {...props}
      />
    </div>
  );
};
