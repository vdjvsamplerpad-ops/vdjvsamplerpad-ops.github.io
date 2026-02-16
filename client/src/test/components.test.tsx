import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, createMockPad } from './utils';
import { SamplerPad } from '@/components/sampler/SamplerPad';
import { validators, validate } from '@/lib/validation';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { LoadingOverlay } from '@/components/ui/loading';

const mockUseAudioPlayer = vi.fn();

vi.mock('@/components/sampler/hooks/useAudioPlayer', () => ({
  useAudioPlayer: (...args: unknown[]) => mockUseAudioPlayer(...args),
}));

describe('SamplerPad Component', () => {
  const audioApi = {
    isPlaying: false,
    progress: 0,
    effectiveVolume: 0.8,
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
    fadeOutStop: vi.fn(),
    brakeStop: vi.fn(),
    backspinStop: vi.fn(),
    filterStop: vi.fn(),
    releaseAudio: vi.fn(),
    queueNextPlaySettings: vi.fn(),
  };

  const renderPad = (padOverrides: Record<string, unknown> = {}) => {
    const pad = createMockPad(padOverrides);
    return renderWithProviders(
      <SamplerPad
        pad={pad as any}
        bankId="test-bank"
        bankName="Test Bank"
        editMode={false}
        globalMuted={false}
        masterVolume={1}
        theme="light"
        stopMode="instant"
        eqSettings={{ low: 0, mid: 0, high: 0 }}
        onUpdatePad={() => {}}
        onRemovePad={() => {}}
      />
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    audioApi.isPlaying = false;
    audioApi.progress = 0;
    audioApi.effectiveVolume = 0.8;
    mockUseAudioPlayer.mockReturnValue(audioApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders pad label', () => {
    const { getByText } = renderPad({ name: 'Test Pad' });
    expect(getByText('Test Pad')).toBeInTheDocument();
  });

  it('plays on click when trigger mode is toggle and currently stopped', () => {
    const { getByRole } = renderPad({ triggerMode: 'toggle' });
    fireEvent.click(getByRole('button'));
    expect(audioApi.playAudio).toHaveBeenCalledTimes(1);
    expect(audioApi.stopAudio).not.toHaveBeenCalled();
  });

  it('stops on click when trigger mode is toggle and currently playing', () => {
    audioApi.isPlaying = true;
    const { getByRole } = renderPad({ triggerMode: 'toggle' });
    fireEvent.click(getByRole('button'));
    expect(audioApi.stopAudio).toHaveBeenCalledTimes(1);
  });

  it('handles hold trigger via mouse down/up', () => {
    const { getByRole } = renderPad({ triggerMode: 'hold' });
    const button = getByRole('button');
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    expect(audioApi.playAudio).toHaveBeenCalledTimes(1);
    expect(audioApi.stopAudio).toHaveBeenCalledTimes(1);
  });
});

describe('Validation System', () => {
  it('validates pad name correctly', () => {
    const nameRules = [
      validators.required('Pad name is required'),
      validators.minLength(1, 'Pad name cannot be empty'),
      validators.maxLength(50, 'Pad name must be 50 characters or less'),
    ];

    expect(validate('Test Pad', nameRules).isValid).toBe(true);
    expect(validate('', nameRules).isValid).toBe(false);
    expect(validate('a'.repeat(51), nameRules).isValid).toBe(false);
  });

  it('validates volume correctly', () => {
    const volumeRules = [
      validators.required('Volume is required'),
      validators.number('Volume must be a number'),
      validators.range(0, 1, 'Volume must be between 0 and 1'),
    ];

    expect(validate(0.5, volumeRules).isValid).toBe(true);
    expect(validate(1.5, volumeRules).isValid).toBe(false);
    expect(validate(-0.1, volumeRules).isValid).toBe(false);
  });

  it('validates audio files correctly', () => {
    const audioRules = [
      validators.required('Audio file is required'),
      validators.audioFile('Please select a valid audio file'),
      validators.fileSize(50, 'Audio file must be less than 50MB'),
    ];

    const validAudioFile = { size: 1024, type: 'audio/mpeg' } as File;
    const invalidFile = { size: 512, type: 'text/plain' } as File;

    expect(validate(validAudioFile, audioRules).isValid).toBe(true);
    expect(validate(invalidFile, audioRules).isValid).toBe(false);
  });
});

describe('Error Boundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('catches and displays errors', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(getByText('Something went wrong')).toBeInTheDocument();
    expect(getByText('Test error')).toBeInTheDocument();
  });

  it('provides error recovery options', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(getByText('Try Again')).toBeInTheDocument();
    expect(getByText('Reload Page')).toBeInTheDocument();
    expect(getByText('Go Home')).toBeInTheDocument();
    expect(getByText('Report Bug')).toBeInTheDocument();
  });
});

describe('Loading States', () => {
  it('shows loading message when loading', () => {
    const { getByText } = renderWithProviders(
      <LoadingOverlay loading={true} message="Loading pads...">
        <div>Content</div>
      </LoadingOverlay>
    );

    expect(getByText('Loading pads...')).toBeInTheDocument();
  });

  it('hides loading overlay when not loading', () => {
    const { getByText, queryByText } = renderWithProviders(
      <LoadingOverlay loading={false} message="Loading pads...">
        <div>Content</div>
      </LoadingOverlay>
    );

    expect(getByText('Content')).toBeInTheDocument();
    expect(queryByText('Loading pads...')).not.toBeInTheDocument();
  });
});
