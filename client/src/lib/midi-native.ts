import * as React from 'react';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import type { MidiInputInfo, MidiMessage, MidiOutputInfo } from '@/lib/midi';

const MIDI_CC_DEDUPE_WINDOW_MS = 20;
const MIDI_CC_CACHE_MAX_SIZE = 256;

type MidiNativePlugin = {
  requestAccess: () => Promise<{ granted?: boolean } | void>;
  getInputs: () => Promise<{ inputs: MidiInputInfo[] }>;
  getOutputs?: () => Promise<{ outputs: MidiOutputInfo[] }>;
  selectInput: (options: { id: string | null }) => Promise<void>;
  sendNoteOn?: (options: { note: number; velocity: number; channel?: number; outputId?: string; outputName?: string }) => Promise<void>;
  sendNoteOff?: (options: { note: number; channel?: number; outputId?: string; outputName?: string }) => Promise<void>;
  addListener: (eventName: 'midi', listenerFunc: (event: MidiMessage) => void) => Promise<PluginListenerHandle> | PluginListenerHandle;
};

const Midi = registerPlugin<MidiNativePlugin>('Midi');

const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as any).Capacitor || Capacitor;
  return capacitor?.isNativePlatform?.() === true && capacitor?.getPlatform?.() === 'android';
};

export function useNativeMidiBackend(enabled: boolean) {
  const [supported] = React.useState<boolean>(() => isNativeAndroid() && Capacitor.isPluginAvailable('Midi'));
  const [accessGranted, setAccessGranted] = React.useState(false);
  const [inputs, setInputs] = React.useState<MidiInputInfo[]>([]);
  const [outputs, setOutputs] = React.useState<MidiOutputInfo[]>([]);
  const [selectedInputId, setSelectedInputIdState] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const listenerRef = React.useRef<PluginListenerHandle | null>(null);
  const lastCcMessageRef = React.useRef<Map<string, { value: number; at: number }>>(new Map());
  const outputSupported = supported && typeof Midi.sendNoteOn === 'function';

  const shouldSkipMessage = React.useCallback((message: MidiMessage): boolean => {
    if (message.type !== 'cc') return false;
    const key = `${message.inputId}:${message.channel}:${message.cc}`;
    const now = Date.now();
    const previous = lastCcMessageRef.current.get(key);
    if (previous && previous.value === message.value && now - previous.at < MIDI_CC_DEDUPE_WINDOW_MS) {
      return true;
    }

    lastCcMessageRef.current.set(key, { value: message.value, at: now });
    if (lastCcMessageRef.current.size > MIDI_CC_CACHE_MAX_SIZE) {
      lastCcMessageRef.current.clear();
    }
    return false;
  }, []);

  const requestAccess = React.useCallback(async () => {
    if (!supported) {
      setError('Native MIDI is not available on this device.');
      return;
    }
    try {
      const result = await Midi.requestAccess();
      setAccessGranted(result?.granted ?? true);
      const inputResponse = await Midi.getInputs();
      setInputs(inputResponse.inputs || []);
      if (Midi.getOutputs) {
        const outputResponse = await Midi.getOutputs();
        setOutputs(outputResponse.outputs || []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access native MIDI.');
    }
  }, [supported]);

  const setSelectedInputId = React.useCallback(async (id: string | null) => {
    setSelectedInputIdState(id);
    if (!supported) return;
    try {
      await Midi.selectInput({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select MIDI input.');
    }
  }, [supported]);

  React.useEffect(() => {
    if (!supported || !enabled) {
      if (listenerRef.current) {
        listenerRef.current.remove();
        listenerRef.current = null;
      }
      return;
    }

    const handleMessage = (message: MidiMessage) => {
      if (shouldSkipMessage(message)) return;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vdjv-midi', { detail: message }));
      }
    };

    const maybePromise = Midi.addListener('midi', handleMessage);
    Promise.resolve(maybePromise).then((handle) => {
      listenerRef.current = handle;
    });

    return () => {
      if (listenerRef.current) {
        listenerRef.current.remove();
        listenerRef.current = null;
      }
    };
  }, [enabled, shouldSkipMessage, supported]);

  const sendNoteOn = React.useCallback(
    (note: number, velocity: number, options?: { outputId?: string; outputName?: string; channel?: number }) => {
      if (!supported || !Midi.sendNoteOn) return;
      Midi.sendNoteOn({
        note,
        velocity,
        channel: options?.channel,
        outputId: options?.outputId,
        outputName: options?.outputName
      }).catch(() => undefined);
    },
    [supported]
  );

  const sendNoteOff = React.useCallback(
    (note: number, options?: { outputId?: string; outputName?: string; channel?: number }) => {
      if (!supported || !Midi.sendNoteOff) return;
      Midi.sendNoteOff({
        note,
        channel: options?.channel,
        outputId: options?.outputId,
        outputName: options?.outputName
      }).catch(() => undefined);
    },
    [supported]
  );

  return {
    backend: 'native' as const,
    supported,
    outputSupported,
    accessGranted,
    inputs,
    outputs,
    selectedInputId,
    setSelectedInputId,
    requestAccess,
    lastMessage: null,
    error,
    sendNoteOn,
    sendNoteOff
  };
}

