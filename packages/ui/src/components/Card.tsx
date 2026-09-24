import React from 'react';

export function Card({
  children,
  padded = true,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }): React.ReactElement {
  const classes = ['card', padded ? 'card--padded' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
