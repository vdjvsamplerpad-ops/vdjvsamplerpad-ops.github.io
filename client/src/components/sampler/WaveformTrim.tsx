import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Square, ZoomIn, ZoomOut } from 'lucide-react';

interface WaveformTrimProps {
  audioUrl: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  onStartTimeChange: (ms: number) => void;
  onEndTimeChange: (ms: number) => void;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

export function WaveformTrim({
  audioUrl,
  startTimeMs,
  endTimeMs,
  durationMs,
  onStartTimeChange,
  onEndTimeChange,
}: WaveformTrimProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  // OPTIMIZATION: Cache the container rect to prevent "Forced Reflow" during drag
  const cachedRectRef = React.useRef<DOMRect | null>(null);

  const [waveformData, setWaveformData] = React.useState<WaveformData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  
  // Zoom & View State
  const [zoom, setZoom] = React.useState(1);
  const [viewOffsetMs, setViewOffsetMs] = React.useState(0);
  
  // Interaction State
  const [isDragging, setIsDragging] = React.useState<'start' | 'end' | 'pan' | null>(null);
  const [dragStartX, setDragStartX] = React.useState(0);
  const [dragStartViewOffset, setDragStartViewOffset] = React.useState(0);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [currentPlayTime, setCurrentPlayTime] = React.useState<number | null>(null);
  
  const previewAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const lastTouchDistance = React.useRef<number | null>(null);

  // --- Helpers ---
  
  const getVisibleDuration = React.useCallback(() => {
    return durationMs / zoom;
  }, [durationMs, zoom]);

  const pixelsToTime = React.useCallback((x: number, width: number) => {
    const visibleDuration = getVisibleDuration();
    const timeInView = (x / width) * visibleDuration;
    return Math.max(0, Math.min(durationMs, viewOffsetMs + timeInView));
  }, [durationMs, viewOffsetMs, getVisibleDuration]);

  const timeToPixels = React.useCallback((time: number, width: number) => {
    const visibleDuration = getVisibleDuration();
    return ((time - viewOffsetMs) / visibleDuration) * width;
  }, [viewOffsetMs, getVisibleDuration]);

  const constrainViewOffset = React.useCallback((offset: number, currentZoom: number) => {
    const visibleDuration = durationMs / currentZoom;
    const maxOffset = Math.max(0, durationMs - visibleDuration);
    return Math.max(0, Math.min(maxOffset, offset));
  }, [durationMs]);

  // Update cached rect on resize
  React.useEffect(() => {
    const updateRect = () => {
      if (containerRef.current) {
        cachedRectRef.current = containerRef.current.getBoundingClientRect();
      }
    };
    
    // Initial measure
    updateRect();
    
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true); // Capture scroll too
    
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, []);

  // --- Waveform Generation (Same as before) ---
  React.useEffect(() => {
    if (!audioUrl || durationMs === 0) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let audioContext: AudioContext | null = null;

    const generateWaveform = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(audioUrl);
        if (cancelled) return;
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (cancelled) return;

        const samples = audioBuffer.getChannelData(0);
        const numPeaks = 2000; 
        const samplesPerPeak = Math.floor(samples.length / numPeaks);
        const peaks: number[] = [];

        for (let i = 0; i < numPeaks; i++) {
          const start = i * samplesPerPeak;
          const end = start + samplesPerPeak;
          let max = 0;
          for (let j = start; j < end; j += 10) { 
            const sample = Math.abs(samples[j]);
            if (sample > max) max = sample;
          }
          peaks.push(max);
        }

        const maxPeak = Math.max(...peaks) || 1;
        const normalizedPeaks = peaks.map(p => p / maxPeak);

        if (!cancelled) {
          setWaveformData({ peaks: normalizedPeaks, duration: audioBuffer.duration });
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to generate waveform:', error);
        if (!cancelled) setIsLoading(false);
      } finally {
        if (audioContext && audioContext.state !== 'closed') audioContext.close();
      }
    };

    generateWaveform();
    return () => { cancelled = true; };
  }, [audioUrl, durationMs]);

  // --- Event Listeners ---

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || isLoading) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // For wheel, we might need a fresh rect if the page scrolled, 
      // but usually cached is safe enough or we re-query cautiously.
      // To strictly avoid forced reflow, we use cachedRectRef if available.
      const rect = cachedRectRef.current || el.getBoundingClientRect();
      
      const x = e.clientX - rect.left;
      const width = rect.width;

      const timeUnderCursor = pixelsToTime(x, width);
      const delta = -e.deltaY * 0.001;
      const newZoom = Math.max(1, Math.min(50, zoom * (1 + delta))); 

      const newVisibleDuration = durationMs / newZoom;
      const newOffset = timeUnderCursor - (x / width) * newVisibleDuration;

      setZoom(newZoom);
      setViewOffsetMs(constrainViewOffset(newOffset, newZoom));
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      // Update cache on start
      cachedRectRef.current = el.getBoundingClientRect();

      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        lastTouchDistance.current = dist;
        return;
      }

      if (e.touches.length === 1) {
        handleInteractionStart(e.touches[0].clientX);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = cachedRectRef.current || el.getBoundingClientRect();
      
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );

        if (lastTouchDistance.current !== null) {
          const delta = dist / lastTouchDistance.current;
          const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const timeUnderCenter = pixelsToTime(centerX, rect.width);
          
          const newZoom = Math.max(1, Math.min(50, zoom * delta));
          
          const newVisibleDuration = durationMs / newZoom;
          const newOffset = timeUnderCenter - (centerX / rect.width) * newVisibleDuration;

          setZoom(newZoom);
          setViewOffsetMs(constrainViewOffset(newOffset, newZoom));
        }
        lastTouchDistance.current = dist;
        return;
      }

      if (e.touches.length === 1) {
        handleInteractionMove(e.touches[0].clientX);
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance.current = null;
      handleInteractionEnd();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isLoading, zoom, viewOffsetMs, durationMs, startTimeMs, endTimeMs, isDragging, dragStartX, dragStartViewOffset]);

  // --- Interaction Logic ---

  const handleInteractionStart = (clientX: number) => {
    if (!containerRef.current) return;
    
    // Use cached rect to update drag start logic
    cachedRectRef.current = containerRef.current.getBoundingClientRect();
    const rect = cachedRectRef.current;
    
    const x = clientX - rect.left;
    const width = rect.width;
    const time = pixelsToTime(x, width);

    const startX = timeToPixels(startTimeMs, width);
    const endX = timeToPixels(endTimeMs, width);
    
    const isNearStart = Math.abs(x - startX) < 20;
    const isNearEnd = Math.abs(x - endX) < 20;

    if (isNearStart) {
      setIsDragging('start');
    } else if (isNearEnd) {
      setIsDragging('end');
    } else {
      if (zoom > 1) {
        setIsDragging('pan');
        setDragStartX(x);
        setDragStartViewOffset(viewOffsetMs);
      } else {
        const distToStart = Math.abs(time - startTimeMs);
        const distToEnd = Math.abs(time - endTimeMs);
        if (distToStart < distToEnd) {
            setIsDragging('start');
            onStartTimeChange(Math.max(0, Math.min(time, endTimeMs - 10)));
        } else {
            setIsDragging('end');
            onEndTimeChange(Math.max(time, startTimeMs + 10));
        }
      }
    }
  };

  const handleInteractionMove = (clientX: number) => {
    if (!containerRef.current || !isDragging) return;
    
    // OPTIMIZATION: Use cached rect
    const rect = cachedRectRef.current || containerRef.current.getBoundingClientRect();
    
    const x = clientX - rect.left;
    const width = rect.width;
    
    if (isDragging === 'pan') {
      const dx = x - dragStartX; 
      const dt = (dx / width) * (durationMs / zoom);
      const newOffset = dragStartViewOffset - dt;
      setViewOffsetMs(constrainViewOffset(newOffset, zoom));
      return;
    }

    const time = pixelsToTime(x, width);
    const clampedTime = Math.max(0, Math.min(durationMs, time));

    if (isDragging === 'start') {
      onStartTimeChange(Math.min(clampedTime, endTimeMs - 10));
    } else {
      onEndTimeChange(Math.max(clampedTime, startTimeMs + 10));
    }
    setHoverTime(clampedTime);
  };

  const handleInteractionEnd = () => {
    setIsDragging(null);
  };

  // React Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    handleInteractionStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (containerRef.current && !isDragging) {
       // Update hover time (uses cached rect if possible, but safe to query if not dragging)
       const rect = cachedRectRef.current || containerRef.current.getBoundingClientRect();
       const x = e.clientX - rect.left;
       setHoverTime(pixelsToTime(x, rect.width));
    }
    handleInteractionMove(e.clientX);
  };

  // --- Canvas Drawing (Same as before) ---
  React.useEffect(() => {
    if (!canvasRef.current || !waveformData || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = containerRef.current.clientWidth;
    const height = 120;
    
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const { peaks } = waveformData;
    const visibleDuration = durationMs / zoom;
    
    const peaksPerMs = peaks.length / durationMs;
    const startPeakIndex = Math.floor(viewOffsetMs * peaksPerMs);
    const endPeakIndex = Math.ceil((viewOffsetMs + visibleDuration) * peaksPerMs);
    
    const visiblePeaks = peaks.slice(
        Math.max(0, startPeakIndex), 
        Math.min(peaks.length, endPeakIndex)
    );

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    const startX = timeToPixels(startTimeMs, width);
    const endX = timeToPixels(endTimeMs, width);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
    
    const drawStartX = Math.max(0, startX);
    const drawEndX = Math.min(width, endX);
    if (drawEndX > drawStartX) {
        ctx.fillRect(drawStartX, 0, drawEndX - drawStartX, height);
    }

    const barWidth = width / visiblePeaks.length;
    const centerY = height / 2;
    const maxBarHeight = height * 0.8;

    ctx.beginPath();
    visiblePeaks.forEach((peak, i) => {
      const x = i * barWidth;
      const isInRange = x >= startX && x <= endX;
      
      ctx.fillStyle = isInRange ? '#3b82f6' : '#6b7280';
      const barH = peak * maxBarHeight;
      ctx.fillRect(x, centerY - barH / 2, Math.max(1, barWidth - 0.5), barH);
    });

    if (startX >= -5 && startX <= width + 5) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();
      
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX - 6, 0);
      ctx.lineTo(startX - 6, 12);
      ctx.lineTo(startX, 18);
      ctx.lineTo(startX, 0);
      ctx.fill();
    }

    if (endX >= -5 && endX <= width + 5) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();
      
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX + 6, 0);
      ctx.lineTo(endX + 6, 12);
      ctx.lineTo(endX, 18);
      ctx.lineTo(endX, 0);
      ctx.fill();
    }

    if (isPreviewing && currentPlayTime !== null) {
        const phX = timeToPixels(currentPlayTime, width);
        if (phX >= 0 && phX <= width) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(phX, 0);
            ctx.lineTo(phX, height);
            ctx.stroke();
        }
    }

    if (hoverTime !== null && !isDragging) {
        const hX = timeToPixels(hoverTime, width);
        if (hX >= 0 && hX <= width) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hX, 0);
            ctx.lineTo(hX, height);
            ctx.stroke();
        }
    }

  }, [waveformData, startTimeMs, endTimeMs, zoom, viewOffsetMs, isPreviewing, currentPlayTime, hoverTime]);

  const formatTime = (ms: number) => {
    if (!isFinite(ms) || ms < 0) return '0.00s';
    return (ms / 1000).toFixed(3) + 's';
  };

  const handlePreview = () => {
    if (!audioUrl || durationMs <= 0) return;

    if (isPreviewing && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewing(false);
      setCurrentPlayTime(null);
      return;
    }

    const audio = new Audio(audioUrl);
    previewAudioRef.current = audio;
    audio.currentTime = startTimeMs / 1000;
    
    const stopTime = endTimeMs / 1000;

    const tick = () => {
        if (!previewAudioRef.current) return;
        const t = previewAudioRef.current.currentTime;
        setCurrentPlayTime(t * 1000);
        if (t >= stopTime) {
            previewAudioRef.current.pause();
            setIsPreviewing(false);
            setCurrentPlayTime(null);
        } else {
            requestAnimationFrame(tick);
        }
    };

    audio.play().then(() => {
        setIsPreviewing(true);
        requestAnimationFrame(tick);
    }).catch(() => setIsPreviewing(false));
    
    audio.onended = () => {
        setIsPreviewing(false);
        setCurrentPlayTime(null);
    };
  };
  
  React.useEffect(() => {
    return () => {
        if (previewAudioRef.current) previewAudioRef.current.pause();
    };
  }, []);

  const effectiveDuration = endTimeMs - startTimeMs;

  return (
    <div className="space-y-4 select-none">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
             <span className="text-green-500 font-bold">IN: {formatTime(startTimeMs)}</span>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-red-500 font-bold">OUT: {formatTime(endTimeMs)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <Button variant="ghost" size="sm" onClick={() => { setZoom(1); setViewOffsetMs(0); }}>
             Reset View
           </Button>
           <span className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded">
             {zoom.toFixed(1)}x
           </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full bg-gray-800 rounded-lg overflow-hidden border border-gray-700 touch-none"
        style={{ height: '120px', cursor: isDragging === 'pan' ? 'grab' : 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(null)}
        onMouseLeave={() => { setIsDragging(null); setHoverTime(null); }}
      >
        {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
        ) : (
            <canvas ref={canvasRef} className="w-full h-full block" />
        )}
        
        {zoom === 1 && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                <span className="text-xs text-white">Scroll to Zoom • Drag to Move</span>
            </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handlePreview}
          variant={isPreviewing ? "destructive" : "default"}
          className="flex-1"
          disabled={isLoading || effectiveDuration <= 0}
        >
          {isPreviewing ? (
            <><Square className="w-4 h-4 mr-2" /> Stop</>
          ) : (
            <><Play className="w-4 h-4 mr-2" /> Preview Loop</>
          )}
        </Button>
      </div>
    </div>
  );
}