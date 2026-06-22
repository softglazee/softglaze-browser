import React from 'react';
import { Loader2 } from 'lucide-react';

export default function Button({ children, variant = 'primary', size = 'md', isLoading, className = '', ...props }) {
  const baseStyle = "inline-flex items-center justify-center font-medium transition-all duration-200 rounded outline-none disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-primary hover:bg-primary-hover text-primary-foreground shadow-glow",
    secondary: "bg-secondary border border-border hover:border-border-strong text-secondary-foreground hover:bg-elevated",
    ghost: "bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground",
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