import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        className
      )}
      style={{
        width: width,
        height: height,
      }}
    />
  );
}

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-muted border-t-primary',
        sizeClasses[size],
        className
      )}
    />
  );
}

interface LoadingOverlayProps {
  children: React.ReactNode;
  loading: boolean;
  message?: string;
  className?: string;
}

export function LoadingOverlay({ children, loading, message = 'Loading...', className }: LoadingOverlayProps) {
  if (!loading) return <>{children}</>;

  return (
    <div className={cn('relative', className)}>
      {children}
      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 rounded-lg bg-card p-6 shadow-lg">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}

interface SkeletonPadProps {
  className?: string;
}

export function SkeletonPad({ className }: SkeletonPadProps) {
  return (
    <div className={cn('aspect-square rounded-lg border-2 border-dashed border-muted-foreground/20', className)}>
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

interface SkeletonBankProps {
  className?: string;
}

export function SkeletonBank({ className }: SkeletonBankProps) {
  return (
    <div className={cn('rounded-lg border p-3', className)}>
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-8" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

interface SkeletonMixerProps {
  className?: string;
}

export function SkeletonMixer({ className }: SkeletonMixerProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
            <Skeleton className="h-3 w-3 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-12" />
            </div>
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
