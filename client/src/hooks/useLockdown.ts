import { useState, useEffect, useCallback, useRef } from 'react';

interface LockdownOptions {
  enabled: boolean;
  onViolation?: (violationType: LockdownViolationType) => void;
  maxViolations?: number;
  onMaxViolationsReached?: () => void;
  warningThreshold?: number; // Warn user before reaching max violations
}

type LockdownViolationType = 
  | 'tab_switch' 
  | 'window_blur' 
  | 'fullscreen_exit' 
  | 'visibility_hidden'
  | 'context_menu'
  | 'key_combination';

interface LockdownState {
  isActive: boolean;
  isFullscreen: boolean;
  violations: LockdownViolation[];
  violationCount: number;
  canContinue: boolean;
  warningCount: number;
}

interface LockdownViolation {
  type: LockdownViolationType;
  timestamp: number;
  description: string;
}

export function useLockdown(options: LockdownOptions) {
  const {
    enabled,
    onViolation,
    maxViolations = 3,
    onMaxViolationsReached,
    warningThreshold = 2
  } = options;

  const [state, setState] = useState<LockdownState>({
    isActive: false,
    isFullscreen: false,
    violations: [],
    violationCount: 0,
    canContinue: true,
    warningCount: 0
  });

  const fullscreenElementRef = useRef<Element | null>(null);
  const lastFocusTimeRef = useRef<number>(Date.now());

  const addViolation = useCallback((type: LockdownViolationType, description: string) => {
    const violation: LockdownViolation = {
      type,
      timestamp: Date.now(),
      description
    };

    setState(prev => {
      const newViolations = [...prev.violations, violation];
      const newCount = newViolations.length;
      const canContinue = newCount < maxViolations;
      const warningCount = Math.max(0, warningThreshold - (maxViolations - newCount));

      return {
        ...prev,
        violations: newViolations,
        violationCount: newCount,
        canContinue,
        warningCount
      };
    });

    // Call violation callback
    if (onViolation) {
      onViolation(type);
    }

    // Check if max violations reached
    if (state.violationCount + 1 >= maxViolations && onMaxViolationsReached) {
      onMaxViolationsReached();
    }
  }, [maxViolations, warningThreshold, onViolation, onMaxViolationsReached, state.violationCount]);

  // Handle visibility change (tab switching, window minimizing)
  const handleVisibilityChange = useCallback(() => {
    if (!enabled || !state.isActive) return;

    if (document.hidden) {
      addViolation('visibility_hidden', 'Browser tab was hidden or switched');
    }
  }, [enabled, state.isActive, addViolation]);

  // Handle window focus/blur
  const handleWindowBlur = useCallback(() => {
    if (!enabled || !state.isActive) return;

    const timeSinceFocus = Date.now() - lastFocusTimeRef.current;
    // Only trigger if the blur happens after user has been focused for a reasonable time
    if (timeSinceFocus > 1000) { // 1 second threshold
      addViolation('window_blur', 'Browser window lost focus');
    }
  }, [enabled, state.isActive, addViolation]);

  const handleWindowFocus = useCallback(() => {
    lastFocusTimeRef.current = Date.now();
  }, []);

  // Handle fullscreen change
  const handleFullscreenChange = useCallback(() => {
    if (!enabled) return;

    const isCurrentlyFullscreen = !!document.fullscreenElement;
    
    setState(prev => ({
      ...prev,
      isFullscreen: isCurrentlyFullscreen
    }));

    if (state.isActive && !isCurrentlyFullscreen && fullscreenElementRef.current) {
      addViolation('fullscreen_exit', 'Exited fullscreen mode');
    }
  }, [enabled, state.isActive, addViolation]);

  // Handle context menu (right-click)
  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (!enabled || !state.isActive) return;

    e.preventDefault();
    addViolation('context_menu', 'Attempted to open context menu');
  }, [enabled, state.isActive, addViolation]);

  // Handle keyboard combinations
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled || !state.isActive) return;

    // Block common key combinations that could be used to cheat or exit
    const blockedCombinations = [
      { key: 'F12', description: 'Developer tools shortcut' },
      { ctrl: true, shift: true, key: 'I', description: 'Developer tools shortcut' },
      { ctrl: true, shift: true, key: 'C', description: 'Element inspector' },
      { ctrl: true, shift: true, key: 'J', description: 'Console shortcut' },
      { ctrl: true, key: 'U', description: 'View source shortcut' },
      { alt: true, key: 'Tab', description: 'Alt+Tab application switching' },
      { ctrl: true, key: 'Tab', description: 'Browser tab switching' },
      { meta: true, key: 'Tab', description: 'Application switching (Mac)' },
      { key: 'F11', description: 'Fullscreen toggle' },
      { alt: true, key: 'F4', description: 'Close window shortcut' }
    ];

    for (const combo of blockedCombinations) {
      const keyMatches = combo.key && e.key === combo.key;
      const ctrlMatches = combo.ctrl ? e.ctrlKey : !e.ctrlKey;
      const shiftMatches = combo.shift ? e.shiftKey : !e.shiftKey;
      const altMatches = combo.alt ? e.altKey : !e.altKey;
      const metaMatches = combo.meta ? e.metaKey : !e.metaKey;

      if (keyMatches && ctrlMatches && shiftMatches && altMatches && metaMatches) {
        e.preventDefault();
        addViolation('key_combination', `Blocked key combination: ${combo.description}`);
        break;
      }
    }
  }, [enabled, state.isActive, addViolation]);

  // Request fullscreen
  const requestFullscreen = useCallback(async (element?: Element): Promise<boolean> => {
    try {
      const targetElement = element || document.documentElement;
      await targetElement.requestFullscreen();
      fullscreenElementRef.current = targetElement;
      return true;
    } catch (error) {
      console.error('Failed to enter fullscreen:', error);
      return false;
    }
  }, []);

  // Exit fullscreen
  const exitFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        fullscreenElementRef.current = null;
      }
      return true;
    } catch (error) {
      console.error('Failed to exit fullscreen:', error);
      return false;
    }
  }, []);

  // Start lockdown mode
  const startLockdown = useCallback(async (element?: Element): Promise<boolean> => {
    if (!enabled) return false;

    const fullscreenSuccess = await requestFullscreen(element);
    
    setState(prev => ({
      ...prev,
      isActive: true,
      isFullscreen: fullscreenSuccess
    }));

    return fullscreenSuccess;
  }, [enabled, requestFullscreen]);

  // End lockdown mode
  const endLockdown = useCallback(async (): Promise<void> => {
    await exitFullscreen();
    
    setState(prev => ({
      ...prev,
      isActive: false,
      isFullscreen: false
    }));
  }, [exitFullscreen]);

  // Reset violations
  const resetViolations = useCallback(() => {
    setState(prev => ({
      ...prev,
      violations: [],
      violationCount: 0,
      canContinue: true,
      warningCount: 0
    }));
  }, []);

  // Set up event listeners
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleVisibilityChange, handleWindowBlur, handleWindowFocus, 
      handleFullscreenChange, handleContextMenu, handleKeyDown]);

  return {
    ...state,
    startLockdown,
    endLockdown,
    resetViolations,
    requestFullscreen,
    exitFullscreen,
    // Helper methods
    getViolationsByType: (type: LockdownViolationType) => 
      state.violations.filter(v => v.type === type),
    getRemainingViolations: () => Math.max(0, maxViolations - state.violationCount),
    isNearMaxViolations: () => state.violationCount >= warningThreshold
  };
}