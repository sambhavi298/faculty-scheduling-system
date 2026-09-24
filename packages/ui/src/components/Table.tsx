import React from 'react';

export function Table({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="table-wrap">
      <table className="table">{children}</table>
    </div>
  );
}
