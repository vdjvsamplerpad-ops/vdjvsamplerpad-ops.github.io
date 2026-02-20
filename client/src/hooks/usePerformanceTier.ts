import { useState, useEffect } from 'react';
import { performanceMonitor, PerformanceTier } from '../lib/performance-monitor';

export function usePerformanceTier() {
  const [tier, setTier] = useState<PerformanceTier>(performanceMonitor.getTier());

  useEffect(() => {
    // Subscribe to tier changes (e.g., if the user manually overrides it in settings)
    const unsubscribe = performanceMonitor.subscribe((newTier) => {
      setTier(newTier);
    });

    return unsubscribe;
  }, []);

  return {
    tier,
    isLow: tier === 'low',
    isMedium: tier === 'medium',
    isHigh: tier === 'high',
    setOverrideTier: (newTier: PerformanceTier | null) => performanceMonitor.setOverrideTier(newTier)
  };
}
