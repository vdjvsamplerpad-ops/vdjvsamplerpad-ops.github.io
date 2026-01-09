import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, createMockPad, createMockBank, simulatePadClick } from './utils';
import { SamplerPad } from '@/components/sampler/SamplerPad';
import { useGlobalPlaybackManager } from '@/components/sampler/hooks/useGlobalPlaybackManager';

// Mock the playback manager
vi.mock('@/components/sampler/hooks/useGlobalPlaybackManager', () => ({
  useGlobalPlaybackManager: vi.fn(),
}));

describe('SamplerPad Component', () => {
  const mockPlaybackManager = {
    registerPad: vi.fn(),
    unregisterPad: vi.fn(),
    playPad: vi.fn(),
    stopPad: vi.fn(),
    togglePad: vi.fn(),
    getPadState: vi.fn(),
    updatePadSettings: vi.fn(),
    updatePadMetadata: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGlobalPlaybackManager as any).mockReturnValue(mockPlaybackManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders pad with correct name and color', () => {
    const pad = createMockPad({
      name: 'Test Pad',
      color: '#ef4444',
    });

    const { getByText, container } = renderWithProviders(
      <SamplerPad
        pad={pad}
        bankId="test-bank"
        bankName="Test Bank"
        isActive={false}
        onClick={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    expect(getByText('Test Pad')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('calls onClick when pad is clicked', async () => {
    const pad = createMockPad();
    const onClick = vi.fn();

    const { getByRole } = renderWithProviders(
      <SamplerPad
        pad={pad}
        bankId="test-bank"
        bankName="Test Bank"
        isActive={false}
        onClick={onClick}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    const padButton = getByRole('button');
    await simulatePadClick(padButton);

    expect(onClick).toHaveBeenCalledWith(pad.id);
  });

  it('shows playing state when pad is active', () => {
    const pad = createMockPad();
    mockPlaybackManager.getPadState.mockReturnValue({
      isPlaying: true,
      progress: 50,
    });

    const { container } = renderWithProviders(
      <SamplerPad
        pad={pad}
        bankId="test-bank"
        bankName="Test Bank"
        isActive={true}
        onClick={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    expect(container.firstChild).toHaveClass('ring-2', 'ring-green-500');
  });

  it('registers pad with playback manager on mount', () => {
    const pad = createMockPad();

    renderWithProviders(
      <SamplerPad
        pad={pad}
        bankId="test-bank"
        bankName="Test Bank"
        isActive={false}
        onClick={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    expect(mockPlaybackManager.registerPad).toHaveBeenCalledWith(
      pad.id,
      pad,
      'test-bank',
      'Test Bank'
    );
  });

  it('unregisters pad with playback manager on unmount', () => {
    const pad = createMockPad();

    const { unmount } = renderWithProviders(
      <SamplerPad
        pad={pad}
        bankId="test-bank"
        bankName="Test Bank"
        isActive={false}
        onClick={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    unmount();

    expect(mockPlaybackManager.unregisterPad).toHaveBeenCalledWith(pad.id);
  });
});

describe('Validation System', () => {
  it('validates pad name correctly', () => {
    const { validators } = require('@/lib/validation');
    
    const nameRules = [
      validators.required('Pad name is required'),
      validators.minLength(1, 'Pad name cannot be empty'),
      validators.maxLength(50, 'Pad name must be 50 characters or less')
    ];

    // Valid name
    expect(validators.validate('Test Pad', nameRules).isValid).toBe(true);
    
    // Empty name
    expect(validators.validate('', nameRules).isValid).toBe(false);
    
    // Too long name
    const longName = 'a'.repeat(51);
    expect(validators.validate(longName, nameRules).isValid).toBe(false);
  });

  it('validates volume correctly', () => {
    const { validators } = require('@/lib/validation');
    
    const volumeRules = [
      validators.required('Volume is required'),
      validators.number('Volume must be a number'),
      validators.range(0, 1, 'Volume must be between 0 and 1')
    ];

    // Valid volume
    expect(validators.validate(0.5, volumeRules).isValid).toBe(true);
    
    // Invalid volume (too high)
    expect(validators.validate(1.5, volumeRules).isValid).toBe(false);
    
    // Invalid volume (negative)
    expect(validators.validate(-0.1, volumeRules).isValid).toBe(false);
  });

  it('validates audio files correctly', () => {
    const { validators } = require('@/lib/validation');
    
    const audioRules = [
      validators.required('Audio file is required'),
      validators.audioFile('Please select a valid audio file'),
      validators.fileSize(50, 'Audio file must be less than 50MB')
    ];

    const validAudioFile = new File(['audio content'], 'test.mp3', { type: 'audio/mpeg' });
    expect(validators.validate(validAudioFile, audioRules).isValid).toBe(true);
    
    const invalidFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    expect(validators.validate(invalidFile, audioRules).isValid).toBe(false);
  });
});

describe('Error Boundary', () => {
  it('catches and displays errors', () => {
    const { ErrorBoundary } = require('@/components/ui/error-boundary');
    
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
    const { ErrorBoundary } = require('@/components/ui/error-boundary');
    
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
  it('shows skeleton when loading', () => {
    const { SkeletonPad, LoadingOverlay } = require('@/components/ui/loading');
    
    const { getByText } = renderWithProviders(
      <LoadingOverlay loading={true} message="Loading pads...">
        <div>Content</div>
      </LoadingOverlay>
    );

    expect(getByText('Loading pads...')).toBeInTheDocument();
  });

  it('hides loading overlay when not loading', () => {
    const { LoadingOverlay } = require('@/components/ui/loading');
    
    const { getByText, queryByText } = renderWithProviders(
      <LoadingOverlay loading={false} message="Loading pads...">
        <div>Content</div>
      </LoadingOverlay>
    );

    expect(getByText('Content')).toBeInTheDocument();
    expect(queryByText('Loading pads...')).not.toBeInTheDocument();
  });
});
