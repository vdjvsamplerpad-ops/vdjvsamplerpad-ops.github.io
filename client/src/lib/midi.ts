import * as React from 'react';
import { Capacitor } from '@capacitor/core';
import { useNativeMidiBackend } from '@/lib/midi-native';

const DEBUG_MIDI = false;
const MIDI_INPUT_CACHE_KEY = 'vdjv-midi-selected-input';

export type MidiMessage =
  | { type: 'noteon'; note: number; velocity: number; channel: number; inputId: string; inputName?: string }
  | { type: 'noteoff'; note: number; velocity: number; channel: number; inputId: string; inputName?: string }
  | { type: 'cc'; cc: number; value: number; channel: number; inputId: string; inputName?: string };

export interface MidiInputInfo {
  id: string;
  name?: string;
  manufacturer?: string;
}

export interface MidiOutputInfo {
  id: string;
  name?: string;
  manufacturer?: string;
}

const toMidiInputs = (access: MIDIAccess | null): MidiInputInfo[] => {
  if (!access) return [];
  return Array.from(access.inputs.values()).map((input) => ({
    id: input.id,
    name: input.name || undefined,
    manufacturer: input.manufacturer || undefined
  }));
};

const toMidiOutputs = (access: MIDIAccess | null): MidiOutputInfo[] => {
  if (!access) return [];
  return Array.from(access.outputs.values()).map((output) => ({
    id: output.id,
    name: output.name || undefined,
    manufacturer: output.manufacturer || undefined
  }));
};

const parseMessage = (event: MIDIMessageEvent): MidiMessage | null => {
  const data = event.data;
  if (!data || data.length < 2) return null;

  const status = data[0];
  const type = status & 0xf0;
  const channel = status & 0x0f;
  const input = event.currentTarget as MIDIInput;
  const inputId = input?.id || 'unknown';
  const inputName = input?.name || undefined;

  if (type === 0x90) {
    const note = data[1];
    const velocity = data[2] ?? 0;
    if (velocity === 0) {
      return { type: 'noteoff', note, velocity, channel, inputId, inputName };
    }
    return { type: 'noteon', note, velocity, channel, inputId, inputName };
  }

  if (type === 0x80) {
    const note = data[1];
    const velocity = data[2] ?? 0;
    return { type: 'noteoff', note, velocity, channel, inputId, inputName };
  }

  if (type === 0xb0) {
    const cc = data[1];
    const value = data[2] ?? 0;
    return { type: 'cc', cc, value, channel, inputId, inputName };
  }

  return null;
};

type MidiBackendState = {
  backend: 'web' | 'native';
  supported: boolean;
  outputSupported: boolean;
  accessGranted: boolean;
  inputs: MidiInputInfo[];
  outputs: MidiOutputInfo[];
  selectedInputId: string | null;
  lastMessage: MidiMessage | null;
  error: string | null;
  requestAccess: () => Promise<void>;
  setSelectedInputId: (id: string | null) => void;
  sendNoteOn: (note: number, velocity: number, options?: { outputId?: string; outputName?: string; channel?: number }) => void;
  sendNoteOff: (note: number, options?: { outputId?: string; outputName?: string; channel?: number }) => void;
};

function useWebMidiBackend(enabled: boolean): MidiBackendState {
  const [supported] = React.useState<boolean>(() => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess);
  const [access, setAccess] = React.useState<MIDIAccess | null>(null);
  const [inputs, setInputs] = React.useState<MidiInputInfo[]>([]);
  const [outputs, setOutputs] = React.useState<MidiOutputInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = React.useState<string | null>(null);
  const [lastMessage, setLastMessage] = React.useState<MidiMessage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const currentInputRef = React.useRef<MIDIInput | null>(null);

  const requestAccess = React.useCallback(async () => {
    if (!supported) {
      setError('Web MIDI is not supported in this browser.');
      return;
    }
    try {
      const midiAccess = await navigator.requestMIDIAccess();
      setAccess(midiAccess);
      setInputs(toMidiInputs(midiAccess));
      setOutputs(toMidiOutputs(midiAccess));
      midiAccess.onstatechange = () => {
        setInputs(toMidiInputs(midiAccess));
        setOutputs(toMidiOutputs(midiAccess));
      };
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access MIDI devices.');
    }
  }, [supported]);

  React.useEffect(() => {
    if (!access || !enabled) {
      if (currentInputRef.current) {
        currentInputRef.current.onmidimessage = null;
        currentInputRef.current = null;
      }
      return;
    }

    const inputsMap = access.inputs;
    const selected = selectedInputId ? inputsMap.get(selectedInputId) || null : null;

    if (currentInputRef.current && currentInputRef.current !== selected) {
      currentInputRef.current.onmidimessage = null;
    }

    if (selected) {
      selected.onmidimessage = (event) => {
        const parsed = parseMessage(event);
        if (!parsed) return;
        if (DEBUG_MIDI) {
          console.log('[MIDI]', {
            device: parsed.inputName || parsed.inputId,
            type: parsed.type,
            note: 'note' in parsed ? parsed.note : undefined,
            cc: 'cc' in parsed ? parsed.cc : undefined,
            velocity: 'velocity' in parsed ? parsed.velocity : undefined,
            value: 'value' in parsed ? parsed.value : undefined,
            channel: parsed.channel
          });
        }
        setLastMessage(parsed);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vdjv-midi', { detail: parsed }));
        }
      };
      currentInputRef.current = selected;
    } else if (!selectedInputId) {
      currentInputRef.current = null;
    }
  }, [access, enabled, selectedInputId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!enabled) return;
    if (!inputs.length) return;
    if (selectedInputId && inputs.some((input) => input.id === selectedInputId)) return;

    try {
      const cachedRaw = localStorage.getItem(MIDI_INPUT_CACHE_KEY);
      const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
      const cachedId = cached?.id as string | undefined;
      const cachedName = cached?.name as string | undefined;

      const byId = cachedId ? inputs.find((input) => input.id === cachedId) : undefined;
      const byName = !byId && cachedName ? inputs.find((input) => input.name === cachedName) : undefined;
      const next = byId || byName || inputs[0];
      if (next && next.id !== selectedInputId) {
        setSelectedInputId(next.id);
      }
    } catch {
      // Ignore cache parse errors
    }
  }, [enabled, inputs, selectedInputId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedInputId) return;
    const selected = inputs.find((input) => input.id === selectedInputId);
    if (!selected) return;
    try {
      localStorage.setItem(
        MIDI_INPUT_CACHE_KEY,
        JSON.stringify({ id: selected.id, name: selected.name || '' })
      );
    } catch {
      // Ignore cache write errors
    }
  }, [selectedInputId, inputs]);

  const sendNoteOn = React.useCallback(
    (note: number, velocity: number, options?: { outputId?: string; outputName?: string; channel?: number }) => {
      if (!access) return;
      const channel = options?.channel ?? 0;
      const outputsMap = access.outputs;
      let output: MIDIOutput | undefined;
      if (options?.outputId) {
        output = outputsMap.get(options.outputId);
      }
      if (!output && options?.outputName) {
        output = Array.from(outputsMap.values()).find((out) => out.name === options.outputName);
      }
      if (!output) {
        output = outputsMap.values().next().value as MIDIOutput | undefined;
      }
      if (!output) return;
      output.send([0x90 + channel, note, Math.max(0, Math.min(127, velocity))]);
    },
    [access]
  );

  const sendNoteOff = React.useCallback(
    (note: number, options?: { outputId?: string; outputName?: string; channel?: number }) => {
      if (!access) return;
      const channel = options?.channel ?? 0;
      const outputsMap = access.outputs;
      let output: MIDIOutput | undefined;
      if (options?.outputId) {
        output = outputsMap.get(options.outputId);
      }
      if (!output && options?.outputName) {
        output = Array.from(outputsMap.values()).find((out) => out.name === options.outputName);
      }
      if (!output) {
        output = outputsMap.values().next().value as MIDIOutput | undefined;
      }
      if (!output) return;
      output.send([0x80 + channel, note, 0]);
    },
    [access]
  );

  return {
    backend: 'web',
    supported,
    outputSupported: outputs.length > 0,
    accessGranted: !!access,
    inputs,
    outputs,
    selectedInputId,
    setSelectedInputId,
    requestAccess,
    lastMessage,
    error,
    sendNoteOn,
    sendNoteOff
  };
}

const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as any).Capacitor || Capacitor;
  return capacitor?.isNativePlatform?.() === true && capacitor?.getPlatform?.() === 'android';
};

export function useWebMidi() {
  const [enabled, setEnabled] = React.useState<boolean>(true);
  const webBackend = useWebMidiBackend(enabled);
  const nativeBackend = useNativeMidiBackend(enabled);

  const useNative = React.useMemo(
    () => isNativeAndroid() && !webBackend.supported && nativeBackend.supported,
    [webBackend.supported, nativeBackend.supported]
  );

  const active = useNative ? nativeBackend : webBackend;

  return {
    backend: active.backend,
    supported: active.supported,
    outputSupported: active.outputSupported,
    enabled,
    accessGranted: active.accessGranted,
    inputs: active.inputs,
    outputs: active.outputs,
    selectedInputId: active.selectedInputId,
    setSelectedInputId: active.setSelectedInputId,
    setEnabled,
    requestAccess: active.requestAccess,
    lastMessage: active.lastMessage,
    error: active.error,
    sendNoteOn: active.sendNoteOn,
    sendNoteOff: active.sendNoteOff
  };
}
