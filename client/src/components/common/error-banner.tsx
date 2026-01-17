import { AlertCircle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'error' | 'warning';
  className?: string;
}

export function ErrorBanner({
  title = 'Error',
  message,
  onRetry,
  onDismiss,
  variant = 'error',
  className = ''
}: ErrorBannerProps) {
  const Icon = variant === 'error' ? XCircle : AlertCircle;
  const colorClasses = variant === 'error'
    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300';

  return (
    <div className={`rounded-lg border p-4 ${colorClasses} ${className}`} role="alert" data-testid="error-banner">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1" data-testid="error-title">{title}</h3>
          <p className="text-sm opacity-90" data-testid="error-message">{message}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-8 px-3"
              data-testid="button-retry"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-8 w-8 p-0"
              data-testid="button-dismiss"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
