import React from 'react';
import { Loader2 } from 'lucide-react';

export default function Button({ children, variant = 'primary', size = 'md', isLoading, className = '', ...props }) {
  const baseStyle = "inline-flex items-center justify-center font-medium transition-all duration-200 rounded-lg outline-none disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-primary hover:bg-primary-hover text-white shadow-glow",
    secondary: "bg-surface border border-border hover:border-muted-dark text-zinc-200",
    ghost: "bg-transparent hover:bg-surface text-muted hover:text-zinc-200",
    danger: "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20"
  };

  const sizes = {
    sm: "text-xs px-3 py-1.5 gap-1.5",
    md: "text-sm px-4 py-2 gap-2",
    lg: "text-base px-5 py-2.5 gap-2"
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`} disabled={isLoading || props.disabled} {...props}>
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {!isLoading && children}
    </button>
  );
}