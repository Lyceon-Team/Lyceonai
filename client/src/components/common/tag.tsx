import { Badge } from "@/components/ui/badge";

interface TagProps {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted';
  className?: string;
}

export function Tag({ children, variant = 'default', className = '' }: TagProps) {
  const variantStyles = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    muted: 'bg-muted text-muted-foreground'
  };

  return (
    <Badge variant="outline" className={`${variantStyles[variant]} ${className}`}>
      {children}
    </Badge>
  );
}
