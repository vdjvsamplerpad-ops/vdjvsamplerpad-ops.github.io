export interface WaveformPeaksData {
  peaks: number[];
  duration: number;
}

const DEFAULT_PEAK_COUNT = 2000;
const waveformDataCache = new Map<string, WaveformPeaksData>();
const waveformDataInFlight = new Map<string, Promise<WaveformPeaksData>>();
const WAVEFORM_LOG_PREFIX = '[WaveformPeaks]';

const formatWaveformKey = (cacheKey: string): string => {
  if (cacheKey.length <= 96) return cacheKey;
  return `${cacheKey.slice(0, 48)}...${cacheKey.slice(-32)}`;
};

const logWaveform = (message: string, details?: Record<string, unknown>) => {
  if (details) {
    console.info(`${WAVEFORM_LOG_PREFIX} ${message}`, details);
    return;
  }
  console.info(`${WAVEFORM_LOG_PREFIX} ${message}`);
};

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const ctor = (window.AudioContext || (window as any).webkitAudioContext) as
    | typeof AudioContext
    | undefined;
  return ctor || null;
};

const decodeWaveformPeaks = async (
  audioUrl: string,
  peakCount: number,
  logKey: string
): Promise<WaveformPeaksData> => {
  const startedAt = Date.now();
  logWaveform('Fetch start', { key: logKey, peakCount });
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Waveform fetch failed (${response.status} ${response.statusText || 'unknown'})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  logWaveform('Fetch complete', {
    key: logKey,
    bytes: arrayBuffer.byteLength,
    elapsedMs: Date.now() - startedAt
  });

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available in this environment.');
  }

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContextCtor();
    logWaveform('Decode start', { key: logKey });
    const decodeStartedAt = Date.now();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    logWaveform('Decode complete', {
      key: logKey,
      elapsedMs: Date.now() - decodeStartedAt,
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      durationSec: Number(audioBuffer.duration.toFixed(3))
    });
    const samples = audioBuffer.getChannelData(0);
    const samplesPerPeak = Math.max(1, Math.floor(samples.length / peakCount));
    const peaks: number[] = [];

    for (let i = 0; i < peakCount; i += 1) {
      const start = i * samplesPerPeak;
      const end = Math.min(samples.length, start + samplesPerPeak);
      let max = 0;
      for (let j = start; j < end; j += 10) {
        const sample = Math.abs(samples[j] || 0);
        if (sample > max) max = sample;
      }
      peaks.push(max);
    }

    const maxPeak = Math.max(...peaks, 1);
    const normalizedPeaks = peaks.map((value) => value / maxPeak);

    const result = {
      peaks: normalizedPeaks,
      duration: audioBuffer.duration
    };
    logWaveform('Peaks ready', {
      key: logKey,
      elapsedMs: Date.now() - startedAt,
      points: normalizedPeaks.length
    });
    return result;
  } catch (error) {
    logWaveform('Decode failed', {
      key: logKey,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }
  }
};

export const loadWaveformPeaks = async (
  audioUrl: string,
  cacheKey: string = audioUrl,
  peakCount: number = DEFAULT_PEAK_COUNT
): Promise<WaveformPeaksData> => {
  const logKey = formatWaveformKey(cacheKey);
  const existing = waveformDataCache.get(cacheKey);
  if (existing) {
    logWaveform('Cache hit', { key: logKey, points: existing.peaks.length });
    return existing;
  }

  const pending = waveformDataInFlight.get(cacheKey);
  if (pending) {
    logWaveform('Join in-flight decode', { key: logKey });
    return pending;
  }

  logWaveform('Queue decode', { key: logKey });
  const task = decodeWaveformPeaks(audioUrl, peakCount, logKey)
    .then((data) => {
      waveformDataCache.set(cacheKey, data);
      waveformDataInFlight.delete(cacheKey);
      logWaveform('Cached decode result', { key: logKey, points: data.peaks.length });
      return data;
    })
    .catch((error) => {
      waveformDataInFlight.delete(cacheKey);
      logWaveform('Decode task failed', {
        key: logKey,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    });

  waveformDataInFlight.set(cacheKey, task);
  return task;
};

export const resampleWaveformPeaks = (peaks: number[], points: number): number[] => {
  if (!Array.isArray(peaks) || peaks.length === 0 || points <= 0) return [];
  if (peaks.length === points) return peaks;

  const sampled: number[] = [];
  const step = peaks.length / points;
  for (let i = 0; i < points; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) {
      if (peaks[j] > max) max = peaks[j];
    }
    sampled.push(max);
  }
  return sampled;
};
