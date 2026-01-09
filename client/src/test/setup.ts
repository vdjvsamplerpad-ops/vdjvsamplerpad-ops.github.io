import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock global objects that might not be available in jsdom
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

// Setup cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
  localStorage.clear();
  sessionStorage.clear();
});
