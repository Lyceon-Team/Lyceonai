import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Bell, 
  CheckCircle, 
  AlertCircle, 
  BookOpen, 
  TrendingUp, 
  Settings,
  Heart,
  Zap,
  X,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Notification, NotificationType, NotificationCategory, NotificationPriority } from "@shared/schema";

const getNotificationIcon = (type: string, category: string) => {
  switch (type) {
    case 'achievement':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'progress_alert':
      return <TrendingUp className="h-4 w-4 text-blue-500" />;
    case 'study_reminder':
      return <BookOpen className="h-4 w-4 text-orange-500" />;
    case 'ai_tutor_suggestion':
      return <Zap className="h-4 w-4 text-purple-500" />;
    case 'system_update':
      return <Settings className="h-4 w-4 text-gray-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-blue-500" />;
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'urgent':
      return 'bg-red-500 text-white';
    case 'high':
      return 'bg-orange-500 text-white';
    case 'normal':
      return 'bg-blue-500 text-white';
    case 'low':
      return 'bg-gray-500 text-white';
    default:
      return 'bg-blue-500 text-white';
  }
};

const formatTimeAgo = (date: Date) => {
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60));
  
  if (diffInMinutes < 1) return 'Just now';
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(date));
};

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [, navigate] = useLocation();
  const getPollingInterval = (ms: number) => (query: { state: { error: unknown } }) => {
    const error = query.state.error;
    if (error instanceof Error && (error.message.startsWith('401:') || error.message.startsWith('403:'))) {
      return false;
    }
    return ms;
  };

  // Fetch notifications
  const { data: notifications = [], isLoading, error: notificationsError, refetch: refetchNotifications } = useQuery<Notification[]>({
    queryKey: ['/api/notifications'],
    refetchInterval: getPollingInterval(30000), // Refetch every 30s, stop polling when unauthorized
  });

  // Fetch unread count
  const { data: unreadData, error: unreadError, refetch: refetchUnreadCount } = useQuery<{ count: number }>({
    queryKey: ['/api/notifications/unread-count'],
    refetchInterval: getPollingInterval(15000), // Check unread count more frequently
  });

  const unreadCount = unreadData?.count || 0;

  // Mark notification as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
      });
      if (!response.ok) throw new Error('Failed to mark notification as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/notifications/mark-all-read', {
        method: 'PATCH',
      });
      if (!response.ok) throw new Error('Failed to mark all notifications as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
    
    if (notification.actionUrl) {
      window.open(notification.actionUrl, '_blank');
    }
  };

  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate();
  };

  const handleRetry = () => {
    refetchNotifications();
    refetchUnreadCount();
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-5"
              variant="destructive"
              data-testid="notification-badge"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        className="w-80 max-h-96"
        data-testid="notification-dropdown"
      >
        <div className="flex items-center justify-between p-4">
          <h3 className="font-semibold text-sm">Notifications</h3>
          <div className="flex items-center space-x-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsReadMutation.isPending}
                data-testid="button-mark-all-read"
              >
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setIsOpen(false);
                navigate('/profile');
              }}
              data-testid="button-notification-settings"
              title="Notification Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
              data-testid="button-close-notifications"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <Separator />
        
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground" data-testid="notifications-loading">
            Loading notifications...
          </div>
        ) : notificationsError ? (
          <div className="p-4 space-y-3" data-testid="notifications-error">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load notifications. {notificationsError instanceof Error ? notificationsError.message : 'Please try again.'}
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="w-full"
              data-testid="button-retry-notifications"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : unreadError ? (
          <div className="p-4 space-y-3" data-testid="unread-count-error">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load unread count. {unreadError instanceof Error ? unreadError.message : 'Please try again.'}
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="w-full"
              data-testid="button-retry-unread"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : (notifications as Notification[]).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">
            <Heart className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
            <p>No notifications yet</p>
            <p className="text-xs mt-1">We'll notify you about your study progress!</p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-1">
              {(notifications as Notification[]).map((notification: Notification) => (
                <div
                  key={notification.id}
                  className={`p-3 hover:bg-muted/50 cursor-pointer transition-colors ${
                    !notification.isRead ? 'bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500' : ''
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                  data-testid={`notification-${notification.id}`}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notification.type, notification.category)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium truncate ${!notification.isRead ? 'font-semibold' : ''}`}>
                          {notification.title}
                        </p>
                        <div className="flex items-center space-x-1 ml-2">
                          {notification.priority !== 'normal' && (
                            <Badge 
                              className={`text-xs px-1.5 py-0.5 ${getPriorityColor(notification.priority)}`}
                              data-testid={`priority-${notification.priority}`}
                            >
                              {notification.priority}
                            </Badge>
                          )}
                          {notification.actionUrl && (
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notification.message}
                      </p>
                      
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(notification.createdAt)}
                        </span>
                        {!notification.isRead && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full" data-testid="unread-indicator" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
