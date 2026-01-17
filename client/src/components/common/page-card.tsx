import { Card, CardHeader, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

interface PageCardProps {
  title?: string;
  description?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PageCard({
  title,
  description,
  headerAction,
  children,
  className = '',
  contentClassName = ''
}: PageCardProps) {
  return (
    <Card className={className} data-testid="page-card">
      {(title || description || headerAction) && (
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
          <div className="space-y-1.5">
            {title && <CardTitle data-testid="card-title">{title}</CardTitle>}
            {description && <CardDescription data-testid="card-description">{description}</CardDescription>}
          </div>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </CardHeader>
      )}
      <CardContent className={contentClassName}>
        {children}
      </CardContent>
    </Card>
  );
}
