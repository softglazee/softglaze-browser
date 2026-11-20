import React from 'react';

export default function Input({ icon: Icon, className = '', ...props }) {
  return (
    <div className="relative flex items-center w-full">
      {Icon && <Icon className="absolute inset-s-3 w-4 h-4 text-muted-foreground pointer-events-none" />}
      <input
        className={`w-full bg-input-background border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all ${Icon ? 'ps-9' : 'ps-3'} pe-3 py-2 ${className}`}
        {...props}
      />
    </div>
  );
}