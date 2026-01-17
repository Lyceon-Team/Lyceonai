import { useState, useEffect, useRef, useCallback } from 'react';

interface TimerOptions {
  duration: number; // Duration in milliseconds
  autoStart?: boolean; // Start timer automatically
  onExpire?: () => void; // Callback when timer expires
  onTick?: (remainingMs: number) => void; // Callback on each second
}

interface TimerState {
  remainingMs: number;
  isActive: boolean;
  isPaused: boolean;
  isExpired: boolean;
  elapsedMs: number;
}

export function useTimer(options: TimerOptions) {
  const { duration, autoStart = false, onExpire, onTick } = options;
  
  const [state, setState] = useState<TimerState>({
    remainingMs: duration,
    isActive: autoStart,
    isPaused: false,
    isExpired: false,
    elapsedMs: 0
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedTimeRef = useRef<number>(0);

  const tick = useCallback(() => {
    setState(prevState => {
      if (!startTimeRef.current) return prevState;
      
      const now = Date.now();
      const elapsed = now - startTimeRef.current - pausedTimeRef.current;
      const remaining = Math.max(0, duration - elapsed);
      const isExpired = remaining === 0;
      
      // Call onTick callback if provided
      if (onTick && remaining > 0) {
        onTick(remaining);
      }
      
      // Call onExpire callback if timer just expired
      if (isExpired && !prevState.isExpired && onExpire) {
        onExpire();
      }
      
      return {
        remainingMs: remaining,
        isActive: remaining > 0,
        isPaused: false,
        isExpired,
        elapsedMs: elapsed
      };
    });
  }, [duration, onExpire, onTick]);

  // Start the timer
  const start = useCallback(() => {
    if (state.isExpired) return;
    
    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    } else if (state.isPaused) {
      // Resume from pause
      pausedTimeRef.current += Date.now() - (startTimeRef.current + state.elapsedMs + pausedTimeRef.current);
    }
    
    setState(prev => ({
      ...prev,
      isActive: true,
      isPaused: false
    }));
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(tick, 100); // Update every 100ms for smoother display
  }, [state.isExpired, state.isPaused, state.elapsedMs, tick]);

  // Pause the timer
  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    setState(prev => ({
      ...prev,
      isActive: false,
      isPaused: !prev.isExpired
    }));
  }, []);

  // Stop and reset the timer
  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    startTimeRef.current = null;
    pausedTimeRef.current = 0;
    
    setState({
      remainingMs: duration,
      isActive: false,
      isPaused: false,
      isExpired: false,
      elapsedMs: 0
    });
  }, [duration]);

  // Restart the timer
  const restart = useCallback(() => {
    reset();
    start();
  }, [reset, start]);

  // Format time as MM:SS or HH:MM:SS
  const formatTime = useCallback((ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }, []);

  // Get progress as percentage (0-100)
  const getProgress = useCallback((): number => {
    if (duration === 0) return 100;
    return Math.max(0, Math.min(100, ((duration - state.remainingMs) / duration) * 100));
  }, [duration, state.remainingMs]);

  // Auto-start if specified
  useEffect(() => {
    if (autoStart && !state.isActive && !state.isExpired) {
      start();
    }
  }, [autoStart, start, state.isActive, state.isExpired]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    ...state,
    start,
    pause,
    reset,
    restart,
    formatTime: formatTime(state.remainingMs),
    formattedElapsed: formatTime(state.elapsedMs),
    progress: getProgress(),
    // Helper methods for common formatting scenarios
    formatRemaining: () => formatTime(state.remainingMs),
    formatElapsed: () => formatTime(state.elapsedMs)
  };
}