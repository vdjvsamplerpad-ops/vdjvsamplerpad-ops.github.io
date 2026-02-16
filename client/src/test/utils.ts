import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock global objects
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaElementSource: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  createGain: vi.fn().mockReturnValue({
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  createBiquadFilter: vi.fn().mockReturnValue({
    frequency: { setValueAtTime: vi.fn() },
    Q: { setValueAtTime: vi.fn() },
    gain: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  createOscillator: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
  }),
  resume: vi.fn().mockResolvedValue(undefined),
  state: 'running',
  currentTime: 0,
  destination: {},
}));

// Mock IndexedDB
const mockIndexedDB = {
  open: vi.fn().mockReturnValue({
    result: {
      createObjectStore: vi.fn(),
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          put: vi.fn().mockReturnValue({
            addEventListener: vi.fn(),
            result: 'test-key',
          }),
          get: vi.fn().mockReturnValue({
            addEventListener: vi.fn(),
            result: null,
          }),
          delete: vi.fn().mockReturnValue({
            addEventListener: vi.fn(),
          }),
        }),
      }),
    },
    addEventListener: vi.fn(),
  }),
};

Object.defineProperty(window, 'indexedDB', {
  value: mockIndexedDB,
  writable: true,
});

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Mock File API
global.File = vi.fn().mockImplementation((content, name, options) => ({
  name,
  size: content.length,
  type: options?.type || 'text/plain',
  lastModified: Date.now(),
}));

global.FileReader = vi.fn().mockImplementation(() => ({
  readAsDataURL: vi.fn(),
  readAsText: vi.fn(),
  result: 'data:text/plain;base64,dGVzdA==',
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock fetch
global.fetch = vi.fn();

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Test utilities
export const TestWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    BrowserRouter,
    null,
    children
  );

export const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper });
};

// Custom matchers
expect.extend({
  toBeValidAudioFile(received: File) {
    const pass = received.type.startsWith('audio/') && received.size > 0;
    return {
      message: () => `expected ${received.name} to be a valid audio file`,
      pass,
    };
  },
  
  toBeValidImageFile(received: File) {
    const pass = received.type.startsWith('image/') && received.size > 0;
    return {
      message: () => `expected ${received.name} to be a valid image file`,
      pass,
    };
  },
  
  toHaveValidHexColor(received: string) {
    const pass = /^#[0-9A-F]{6}$/i.test(received);
    return {
      message: () => `expected ${received} to be a valid hex color`,
      pass,
    };
  },
});

// Test data factories
export const createMockPad = (overrides = {}) => ({
  id: 'test-pad-1',
  name: 'Test Pad',
  audioUrl: 'blob:test-audio-url',
  imageUrl: null,
  color: '#3b82f6',
  volume: 0.8,
  triggerMode: 'toggle' as const,
  playbackMode: 'once' as const,
  startTimeMs: 0,
  endTimeMs: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  pitch: 0,
  ...overrides,
});

export const createMockBank = (overrides = {}) => ({
  id: 'test-bank-1',
  name: 'Test Bank',
  defaultColor: '#3b82f6',
  pads: [createMockPad()],
  ...overrides,
});

export const createMockAudioFile = (name = 'test-audio.mp3') => 
  new File(['audio content'], name, { type: 'audio/mpeg' });

export const createMockImageFile = (name = 'test-image.jpg') => 
  new File(['image content'], name, { type: 'image/jpeg' });

// Test helpers
export const waitForAudioToLoad = async (audioElement: HTMLAudioElement) => {
  return new Promise<void>((resolve) => {
    if (audioElement.readyState >= 2) {
      resolve();
    } else {
      audioElement.addEventListener('canplaythrough', () => resolve(), { once: true });
    }
  });
};

export const simulatePadClick = async (padElement: HTMLElement) => {
  fireEvent.click(padElement);
  // Wait for any async operations
  await waitFor(() => {
    expect(padElement).toBeInTheDocument();
  });
};

export const mockAudioContext = () => {
  const mockContext = {
    createMediaElementSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createGain: vi.fn().mockReturnValue({
      gain: { 
        setValueAtTime: vi.fn(), 
        linearRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBiquadFilter: vi.fn().mockReturnValue({
      frequency: { setValueAtTime: vi.fn() },
      Q: { setValueAtTime: vi.fn() },
      gain: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    resume: vi.fn().mockResolvedValue(undefined),
    state: 'running',
    currentTime: 0,
    destination: {},
  };
  
  return mockContext;
};

// Cleanup utilities
export const cleanupMocks = () => {
  vi.clearAllMocks();
  vi.clearAllTimers();
  localStorage.clear();
  sessionStorage.clear();
};

// Test configuration
export const testConfig = {
  timeout: 10000,
  retries: 2,
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};

// Export test utilities
export {
  render,
  screen,
  fireEvent,
  waitFor,
  vi as jest,
};
