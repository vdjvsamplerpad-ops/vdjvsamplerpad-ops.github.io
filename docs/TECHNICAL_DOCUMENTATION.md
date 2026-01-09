# VDJV Sampler Pad - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Development](#development)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [API Reference](#api-reference)
8. [Troubleshooting](#troubleshooting)

## Overview

VDJV Sampler Pad is a professional DJ sampler pad application built with React, TypeScript, and modern web technologies. It provides advanced audio controls, bank management, and real-time audio processing capabilities.

### Key Features
- **Multi-bank Management**: Organize samples into banks with custom colors
- **Advanced Audio Controls**: Volume, pitch, fade-in/out, EQ, and filter effects
- **Real-time Playback**: Low-latency audio playback with Web Audio API
- **Cross-platform**: Works on desktop, mobile, and as a PWA
- **Offline Support**: Full functionality without internet connection
- **Cloud Sync**: Optional cloud storage and sharing

## Architecture

### Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Audio**: Web Audio API, AudioContext
- **Storage**: IndexedDB, localStorage
- **Authentication**: Supabase Auth
- **Build Tool**: Vite
- **Testing**: Vitest, React Testing Library

### Core Components

#### Audio Management
```typescript
// Global playback manager handles all audio operations
import { useGlobalPlaybackManager } from '@/components/sampler/hooks/useGlobalPlaybackManager';

const playbackManager = useGlobalPlaybackManager();
playbackManager.registerPad(padId, padData, bankId, bankName);
playbackManager.playPad(padId);
```

#### State Management
```typescript
// Sampler store manages banks and pads
import { useSamplerStore } from '@/components/sampler/hooks/useSamplerStore';

const { banks, addPad, createBank, importBank } = useSamplerStore();
```

#### Authentication
```typescript
// Auth hook for user management
import { useAuth } from '@/hooks/useAuth';

const { user, signIn, signUp, signOut } = useAuth();
```

### Data Flow
1. **User Interaction** → Component Event Handler
2. **State Update** → Sampler Store / Playback Manager
3. **Audio Processing** → Web Audio API
4. **Persistence** → IndexedDB / localStorage
5. **UI Update** → React Re-render

## Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Modern browser with Web Audio API support

### Local Development
```bash
# Clone repository
git clone <repository-url>
cd vdjv-sampler-pad

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Environment Variables
Create `.env.local` file:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Development

### Project Structure
```
client/
├── src/
│   ├── components/
│   │   ├── sampler/          # Main sampler components
│   │   ├── auth/             # Authentication components
│   │   └── ui/               # Reusable UI components
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utility functions
│   ├── test/                 # Test files
│   └── types/                # TypeScript type definitions
├── public/                   # Static assets
└── index.html               # Entry point
```

### Adding New Features

#### 1. Create Component
```typescript
// src/components/sampler/NewFeature.tsx
import React from 'react';
import { useSamplerStore } from '@/hooks/useSamplerStore';

export function NewFeature() {
  const { banks } = useSamplerStore();
  
  return (
    <div className="p-4">
      {/* Component content */}
    </div>
  );
}
```

#### 2. Add to Main App
```typescript
// src/components/sampler/SamplerPadApp.tsx
import { NewFeature } from './NewFeature';

export function SamplerPadApp() {
  return (
    <div>
      {/* Existing components */}
      <NewFeature />
    </div>
  );
}
```

#### 3. Add Tests
```typescript
// src/test/NewFeature.test.tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from './utils';
import { NewFeature } from '@/components/sampler/NewFeature';

describe('NewFeature', () => {
  it('renders correctly', () => {
    const { getByText } = renderWithProviders(<NewFeature />);
    expect(getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### Code Style Guidelines

#### TypeScript
- Use strict mode
- Prefer interfaces over types for object shapes
- Use generic types for reusable components
- Document complex functions with JSDoc

#### React
- Use functional components with hooks
- Implement proper error boundaries
- Use React.memo for performance optimization
- Follow naming conventions (PascalCase for components)

#### CSS/Tailwind
- Use Tailwind utility classes
- Create custom components for repeated patterns
- Use CSS variables for theme customization
- Follow mobile-first responsive design

## Testing

### Test Structure
```
src/test/
├── utils.ts              # Test utilities and mocks
├── components.test.tsx   # Component tests
├── hooks.test.ts        # Hook tests
└── integration.test.ts  # Integration tests
```

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test components.test.tsx
```

### Writing Tests
```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from './utils';

describe('ComponentName', () => {
  it('should render correctly', () => {
    const { getByText } = renderWithProviders(<Component />);
    expect(getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interactions', async () => {
    const mockFn = vi.fn();
    const { getByRole } = renderWithProviders(<Component onClick={mockFn} />);
    
    fireEvent.click(getByRole('button'));
    expect(mockFn).toHaveBeenCalled();
  });
});
```

## Deployment

### Web Deployment (PWA)
```bash
# Build for production
npm run build

# Deploy to Vercel/Netlify
# The build output is in dist/ directory
```

### Desktop App (Electron)
```bash
# Install Electron dependencies
npm install --save-dev electron electron-builder

# Build desktop app
npm run build:electron

# Package for distribution
npm run dist
```

### Mobile App (Capacitor)
```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli

# Initialize Capacitor
npx cap init

# Add platforms
npx cap add android
npx cap add ios

# Build and sync
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

## API Reference

### Sampler Store API
```typescript
interface SamplerStore {
  // Banks
  banks: SamplerBank[];
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  
  // Bank operations
  createBank(name: string, color: string): string;
  updateBank(id: string, updates: Partial<SamplerBank>): void;
  deleteBank(id: string): void;
  setPrimaryBank(id: string): void;
  setSecondaryBank(id: string): void;
  
  // Pad operations
  addPad(bankId: string, pad: Partial<SamplerPad>): string;
  updatePad(bankId: string, padId: string, updates: Partial<SamplerPad>): void;
  removePad(bankId: string, padId: string): void;
  
  // Import/Export
  importBank(file: File): Promise<void>;
  exportBank(id: string): Promise<Blob>;
}
```

### Playback Manager API
```typescript
interface GlobalPlaybackManager {
  // Pad registration
  registerPad(padId: string, padData: any, bankId: string, bankName: string): Promise<void>;
  unregisterPad(padId: string): void;
  
  // Playback control
  playPad(padId: string): void;
  stopPad(padId: string, mode?: StopMode): void;
  togglePad(padId: string): void;
  
  // Settings
  updatePadSettings(padId: string, settings: any): void;
  updatePadMetadata(padId: string, metadata: any): void;
  
  // Global controls
  setGlobalMute(muted: boolean): void;
  setMasterVolume(volume: number): void;
  applyGlobalEQ(eqSettings: EqSettings): void;
  
  // State
  getPadState(padId: string): { isPlaying: boolean; progress: number } | null;
  getAllPlayingPads(): PlayingPad[];
}
```

### Validation API
```typescript
// Validation rules
const validators = {
  required(message?: string): ValidationRule<any>;
  minLength(min: number, message?: string): ValidationRule<string>;
  maxLength(max: number, message?: string): ValidationRule<string>;
  email(message?: string): ValidationRule<string>;
  number(message?: string): ValidationRule<any>;
  range(min: number, max: number, message?: string): ValidationRule<number>;
  fileSize(maxSizeMB: number, message?: string): ValidationRule<File>;
  audioFile(message?: string): ValidationRule<File>;
  imageFile(message?: string): ValidationRule<File>;
};

// Validation hook
function useValidation<T>(initialValue: T, rules: ValidationRule<T>[]): {
  value: T;
  errors: string[];
  isValid: boolean;
  handleChange: (value: T) => void;
  handleBlur: () => void;
  reset: () => void;
};
```

## Troubleshooting

### Common Issues

#### Audio Not Playing
1. **iOS Safari**: Ensure user interaction before playing audio
2. **AudioContext Suspended**: Call `audioContext.resume()` on user gesture
3. **File Format**: Check if audio file is supported (MP3, WAV, OGG)
4. **CORS**: Ensure audio files are served with proper CORS headers

#### Storage Issues
1. **QuotaExceededError**: Large files stored in IndexedDB, not localStorage
2. **IndexedDB Unavailable**: Fallback to localStorage with size limits
3. **Data Loss**: Implement backup/restore functionality

#### Performance Issues
1. **Memory Leaks**: Properly dispose of AudioContext and event listeners
2. **Large Files**: Implement streaming for files > 50MB
3. **Multiple Audio**: Limit concurrent audio instances

#### PWA Issues
1. **Service Worker**: Ensure proper caching strategy
2. **Offline Mode**: Test offline functionality
3. **Installation**: Check manifest.json and icons

### Debug Tools
```typescript
// Debug playback manager
(window as any).debugPlaybackManager();

// Debug sampler store
(window as any).debugSamplerStore();

// Performance monitoring
console.log('Audio instances:', playbackManager.getDebugInfo());
```

### Error Reporting
The app includes comprehensive error reporting:
- Error boundaries catch React errors
- Global error handler for unhandled errors
- User-friendly error messages
- Error ID generation for tracking
- Development mode shows stack traces

### Performance Monitoring
```typescript
// Monitor audio performance
const audioStats = {
  activeInstances: playbackManager.getAllPlayingPads().length,
  memoryUsage: performance.memory?.usedJSHeapSize,
  audioContextState: audioContext.state,
};

console.log('Audio Stats:', audioStats);
```

## Contributing

### Development Workflow
1. Create feature branch from `main`
2. Implement feature with tests
3. Update documentation
4. Submit pull request
5. Code review and merge

### Code Quality
- Run linter: `npm run lint`
- Run type check: `npm run type-check`
- Run tests: `npm test`
- Check build: `npm run build`

### Release Process
1. Update version in `package.json`
2. Update changelog
3. Create release tag
4. Deploy to production
5. Update documentation

---

For more information, contact the development team or check the project repository.
