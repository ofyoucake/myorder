import React from 'react';

export const Button = ({ children, variant = 'primary', size = 'standard', ...props }) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isActive, setIsActive] = React.useState(false);

  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    userSelect: 'none',
    position: 'relative',
    letterSpacing: '-0.02em',
    fontFamily: 'inherit',
    outline: 'none',
  };

  const variants = {
    primary: {
      backgroundColor: 'var(--point)',
      color: 'var(--bg-main)',
      boxShadow: isHovered ? 'var(--shadow-elevation)' : 'none',
      transform: isActive ? 'scale(0.98)' : 'none',
    },
    secondary: {
      backgroundColor: 'var(--bg-main)',
      color: 'var(--text-main)',
      border: '1px solid var(--line)',
      boxShadow: isHovered ? 'var(--shadow-elevation)' : 'none',
      transform: isActive ? 'scale(0.98)' : 'none',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--text-sub)',
      transform: isActive ? 'scale(0.98)' : 'none',
    }
  };

  const sizes = {
    compact: { height: '36px', padding: '0 16px', fontSize: '13px' },
    standard: { height: '48px', padding: '0 24px', fontSize: '14px' },
    large: { height: '54px', padding: '0 32px', fontSize: '15px' },
  };

  const finalStyles = {
    ...baseStyles,
    ...variants[variant],
    ...sizes[size],
    ...props.style
  };

  const { style, ...otherProps } = props;

  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setIsActive(false); }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      style={finalStyles}
      {...otherProps}
    >
      {children}
    </button>
  );
};
