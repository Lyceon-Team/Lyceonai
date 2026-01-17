import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyState({
  title = "Nothing here yet",
  description = "Try changing filters or add new content.",
  action,
}: {
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Card data-testid="empty-state">
      <CardContent className="p-8 text-center space-y-3">
        <div className="text-lg font-medium" data-testid="empty-state-title">
          {title}
        </div>
        <p className="text-muted-foreground" data-testid="empty-state-description">
          {description}
        </p>
        {action ? (
          <Button onClick={action.onClick} data-testid="empty-state-action">
            {action.label}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
