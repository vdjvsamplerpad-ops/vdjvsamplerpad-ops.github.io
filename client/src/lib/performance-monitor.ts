export type PerformanceTier = 'low' | 'medium' | 'high';

export interface DeviceCapabilities {
  tier: PerformanceTier;
  hardwareConcurrency: number;
  deviceMemory: number;
  isMobile: boolean;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private currentTier: PerformanceTier = 'high';
  private capabilities: DeviceCapabilities;
  private tierChangeListeners: Set<(tier: PerformanceTier) => void> = new Set();
  
  // Optional override for testing or manual user preference (Auto, Low, Medium, High)
  private overrideTier: PerformanceTier | null = null;

  private constructor() {
    this.capabilities = this.detectCapabilities();
    this.currentTier = this.evaluateInitialTier(this.capabilities);
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private detectCapabilities(): DeviceCapabilities {
    // navigator.hardwareConcurrency usually returns the number of logical processors.
    const concurrency = navigator.hardwareConcurrency || 4;
    // navigator.deviceMemory returns approximate RAM in GB. Typically 2, 4, 8.
    const memory = (navigator as any).deviceMemory || 4;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    return {
      hardwareConcurrency: concurrency,
      deviceMemory: memory,
      isMobile,
      tier: 'high', // overwritten in evaluateInitialTier
    };
  }

  private evaluateInitialTier(caps: DeviceCapabilities): PerformanceTier {
    let score = 0;

    // CPU score
    if (caps.hardwareConcurrency >= 8) score += 3;
    else if (caps.hardwareConcurrency >= 4) score += 2;
    else score += 1;

    // Memory score
    if (caps.deviceMemory >= 8) score += 3;
    else if (caps.deviceMemory >= 4) score += 2;
    else score += 1;

    if (caps.isMobile) {
      // Mobile devices are generally penalized slightly in this raw heuristic to err on the side of caution
      score -= 1; 
    }

    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  public getTier(): PerformanceTier {
    return this.overrideTier || this.currentTier;
  }

  public getCapabilities(): DeviceCapabilities {
    return this.capabilities;
  }

  public setOverrideTier(tier: PerformanceTier | null) {
    this.overrideTier = tier;
    this.notifyListeners();
  }

  public subscribe(listener: (tier: PerformanceTier) => void): () => void {
    this.tierChangeListeners.add(listener);
    listener(this.getTier());
    return () => this.tierChangeListeners.delete(listener);
  }

  private notifyListeners() {
    const tier = this.getTier();
    this.tierChangeListeners.forEach(l => l(tier));
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();
