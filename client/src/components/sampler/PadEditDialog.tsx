import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { PadData, SamplerBank } from './types/sampler';
import { WaveformTrim } from './WaveformTrim';
import { isReservedShortcutCombo, normalizeShortcutKey, normalizeStoredShortcutKey, RESERVED_SHORTCUT_KEYS } from '@/lib/keyboard-shortcuts';
import { MidiMessage } from '@/lib/midi';
import { LED_COLOR_PALETTE } from '@/lib/led-colors';

interface PadEditDialogProps {
  pad: PadData;
  allBanks?: SamplerBank[];
  allPads?: PadData[];
  bankPads?: PadData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pad: PadData) => void;
  onUnload: () => void;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
}

const PAD_PRIMARY_COLOR_NAMES = [
  'Dim Gray',
  'Gray',
  'White',
  'Red',
  'Amber',
  'Orange',
  'Light Yellow',
  'Yellow',
  'Green',
  'Aqua',
  'Blue',
  'Pure Blue',
  'Violet',
  'Purple',
  'Hot Pink',
  'Hot Pink 2',
  'Deep Magenta',
  'Deep Brown 2'
];

const colorOptions = LED_COLOR_PALETTE
  .filter((entry) => entry.velocity > 0)
  .filter((entry, index, arr) => arr.findIndex((item) => item.hex === entry.hex) === index)
  .map((entry) => ({ label: entry.name, value: entry.hex }));

const primaryPadColors = PAD_PRIMARY_COLOR_NAMES
  .map((name) => colorOptions.find((entry) => entry.label === name))
  .filter(Boolean) as Array<{ label: string; value: string }>;

const extraPadColors = colorOptions.filter(
  (entry) => !primaryPadColors.some((primary) => primary.value === entry.value)
);

export function PadEditDialog({
  pad,
  allBanks = [],
  allPads = [],
  bankPads = [],
  open,
  onOpenChange,
  onSave,
  onUnload,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs
}: PadEditDialogProps) {
  type PadWithMidi = PadData & { midiNote?: number; midiCC?: number };
  const [name, setName] = React.useState(pad.name);
  const [color, setColor] = React.useState(pad.color);
  const [triggerMode, setTriggerMode] = React.useState(pad.triggerMode);
  const [playbackMode, setPlaybackMode] = React.useState(pad.playbackMode);
  const [volume, setVolume] = React.useState([pad.volume * 100]);
  const [startTimeMs, setStartTimeMs] = React.useState([pad.startTimeMs || 0]);
  const [endTimeMs, setEndTimeMs] = React.useState([pad.endTimeMs || 0]);
  const [fadeInMs, setFadeInMs] = React.useState([pad.fadeInMs || 0]);
  const [fadeOutMs, setFadeOutMs] = React.useState([pad.fadeOutMs || 0]);
  const [pitch, setPitch] = React.useState([pad.pitch || 0]);
  const [imageUrl, setImageUrl] = React.useState(pad.imageUrl || '');
  const [imageData, setImageData] = React.useState(pad.imageData || '');
  const [shortcutKey, setShortcutKey] = React.useState(pad.shortcutKey || '');
  const [shortcutError, setShortcutError] = React.useState<string | null>(null);
  const [midiError, setMidiError] = React.useState<string | null>(null);
  const [midiNote, setMidiNote] = React.useState<number | undefined>((pad as PadWithMidi).midiNote);
  const [midiCC, setMidiCC] = React.useState<number | undefined>((pad as PadWithMidi).midiCC);
  const [ignoreChannel, setIgnoreChannel] = React.useState(!!pad.ignoreChannel);
  const [midiLearnActive, setMidiLearnActive] = React.useState(false);
  const [audioDuration, setAudioDuration] = React.useState(0);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [showUnloadConfirm, setShowUnloadConfirm] = React.useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = React.useState(false);
  const [showAllColors, setShowAllColors] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const initialSnapshotRef = React.useRef<string>('');

  React.useEffect(() => {
    if (open) {
      setName(pad.name);
      setColor(pad.color);
      setTriggerMode(pad.triggerMode);
      setPlaybackMode(pad.playbackMode);
      setVolume([pad.volume * 100]);
      setStartTimeMs([pad.startTimeMs || 0]);
      setEndTimeMs([pad.endTimeMs || 0]);
      setFadeInMs([pad.fadeInMs || 0]);
      setFadeOutMs([pad.fadeOutMs || 0]);
      setPitch([pad.pitch || 0]);
      setImageUrl(pad.imageUrl || '');
      setImageData(pad.imageData || '');
      setShortcutKey(pad.shortcutKey || '');
      setShortcutError(null);
      setMidiNote((pad as PadWithMidi).midiNote);
      setMidiCC((pad as PadWithMidi).midiCC);
      setIgnoreChannel(!!pad.ignoreChannel);
      setMidiLearnActive(false);
      setMidiError(null);
      setUploadError(null);
      initialSnapshotRef.current = JSON.stringify({
        name: pad.name,
        color: pad.color,
        triggerMode: pad.triggerMode,
        playbackMode: pad.playbackMode,
        volume: pad.volume,
        startTimeMs: pad.startTimeMs || 0,
        endTimeMs: pad.endTimeMs || 0,
        fadeInMs: pad.fadeInMs || 0,
        fadeOutMs: pad.fadeOutMs || 0,
        pitch: pad.pitch || 0,
        imageUrl: pad.imageUrl || '',
        imageData: pad.imageData || '',
        shortcutKey: pad.shortcutKey || '',
        midiNote: (pad as PadWithMidi).midiNote ?? null,
        midiCC: (pad as PadWithMidi).midiCC ?? null,
        ignoreChannel: !!pad.ignoreChannel
      });

      if (pad.audioUrl) {
        let durationLoaded = false;
        
        // Method 1: Try HTMLAudioElement (works on most browsers)
        const audio = new Audio(pad.audioUrl);
        audio.addEventListener('loadedmetadata', () => {
          if (!durationLoaded && audio.duration && isFinite(audio.duration)) {
            durationLoaded = true;
            setAudioDuration(audio.duration * 1000);
            if (endTimeMs[0] === 0) {
              setEndTimeMs([audio.duration * 1000]);
            }
          }
        });
        
        // Method 2: Fallback using Web Audio API (better iOS support)
        // This fires if HTMLAudioElement doesn't load metadata within 500ms
        const fallbackTimeout = setTimeout(async () => {
          if (durationLoaded) return;
          
          try {
            const response = await fetch(pad.audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            if (!durationLoaded) {
              durationLoaded = true;
              const durationMs = audioBuffer.duration * 1000;
              setAudioDuration(durationMs);
              if (endTimeMs[0] === 0) {
                setEndTimeMs([durationMs]);
              }
            }
            
            audioContext.close();
          } catch (error) {
            console.warn('Failed to decode audio for duration:', error);
            // Use pad's existing endTimeMs if available
            if (pad.endTimeMs > 0) {
              setAudioDuration(pad.endTimeMs);
            }
          }
        }, 500);
        
        return () => clearTimeout(fallbackTimeout);
      }
    }
  }, [open, pad]);

  const getCurrentSnapshot = React.useCallback(() => {
    return JSON.stringify({
      name,
      color,
      triggerMode,
      playbackMode,
      volume: volume[0] / 100,
      startTimeMs: startTimeMs[0],
      endTimeMs: endTimeMs[0],
      fadeInMs: fadeInMs[0],
      fadeOutMs: fadeOutMs[0],
      pitch: pitch[0],
      imageUrl,
      imageData,
      shortcutKey: shortcutKey || '',
      midiNote: midiNote ?? null,
      midiCC: midiCC ?? null,
      ignoreChannel
    });
  }, [
    name,
    color,
    triggerMode,
    playbackMode,
    volume,
    startTimeMs,
    endTimeMs,
    fadeInMs,
    fadeOutMs,
    pitch,
    imageUrl,
    imageData,
    shortcutKey,
    midiNote,
    midiCC,
    ignoreChannel
  ]);

  const isDirty = React.useMemo(() => {
    if (!open) return false;
    return initialSnapshotRef.current !== getCurrentSnapshot();
  }, [open, getCurrentSnapshot]);

  React.useEffect(() => {
    if (!midiLearnActive) return;

    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (detail.type === 'noteon') {
        if (blockedMidiNotes?.has(detail.note)) {
          setMidiError('That MIDI note is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((bank) => typeof bank.midiNote === 'number' && bank.midiNote === detail.note);
        if (duplicateBank) {
          setMidiError(`That MIDI note is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = bankPads.find((otherPad) => {
          if (otherPad.id === pad.id) return false;
          return typeof otherPad.midiNote === 'number' && otherPad.midiNote === detail.note;
        });
        if (duplicatePad) {
          setMidiError(`That MIDI note is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiNote(detail.note);
      } else if (detail.type === 'cc') {
        if (blockedMidiCCs?.has(detail.cc)) {
          setMidiError('That MIDI CC is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((bank) => typeof bank.midiCC === 'number' && bank.midiCC === detail.cc);
        if (duplicateBank) {
          setMidiError(`That MIDI CC is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = bankPads.find((otherPad) => {
          if (otherPad.id === pad.id) return false;
          return typeof otherPad.midiCC === 'number' && otherPad.midiCC === detail.cc;
        });
        if (duplicatePad) {
          setMidiError(`That MIDI CC is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiCC(detail.cc);
      } else {
        return;
      }
      setMidiError(null);
      setMidiLearnActive(false);
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [midiLearnActive, blockedMidiNotes, blockedMidiCCs, allBanks, bankPads, pad.id]);

  // Image validation function
  const validateImage = (file: File): Promise<{ valid: boolean; error?: string }> => {
    return new Promise((resolve) => {
      // Check file type
      if (!file.type.startsWith('image/jpeg') && !file.type.startsWith('image/png') && !file.type.startsWith('image/webp')) {
        resolve({
          valid: false,
          error: 'Invalid file type. Please select a JPG, PNG, or WebP image.'
        });
        return;
      }

      // Check file size (2MB limit - much more reasonable)
      const maxSize = 2 * 1024 * 1024; // 2MB
      if (file.size > maxSize) {
        resolve({
          valid: false,
          error: `Image too large. Please use an image under 2MB. Current size: ${(file.size / 1024 / 1024).toFixed(1)}MB`
        });
        return;
      }

      // Check dimensions (1024x1024 limit - standard logo size)
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        if (img.width > 1024 || img.height > 1024) {
          resolve({
            valid: false,
            error: `Image too large. Please use an image under 1024x1024px. Current dimensions: ${img.width}x${img.height}px`
          });
        } else {
          resolve({ valid: true });
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({
          valid: false,
          error: 'Invalid image file. Please select a valid JPG, PNG, or WebP image.'
        });
      };

      img.src = url;
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      // Validate the image
      const validation = await validateImage(file);
      if (!validation.valid) {
        setUploadError(validation.error || 'Invalid image file');
        return;
      }

      // Create object URL for preview
      const imageUrl = URL.createObjectURL(file);
      
      // Convert to base64 for storage
      const reader = new FileReader();
      reader.onload = () => {
        setImageData(reader.result as string);
        setImageUrl(imageUrl);
        setUploadError(null);
      };
      reader.onerror = () => {
        setUploadError('Failed to process image file');
        URL.revokeObjectURL(imageUrl);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Image upload error:', error);
      setUploadError('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
      // Clear the input
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    if (imageUrl && imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrl);
    }
    setImageUrl('');
    setImageData('');
    setUploadError(null);
  };

  const applyShortcutKey = (nextKey: string | null) => {
    if (!nextKey) {
      setShortcutKey('');
      setShortcutError(null);
      return;
    }

    if (isReservedShortcutCombo(nextKey)) {
      setShortcutError(`"${nextKey}" is reserved for global controls.`);
      return;
    }

    if (blockedShortcutKeys?.has(nextKey)) {
      setShortcutError(`"${nextKey}" is already assigned to system or channel mapping.`);
      return;
    }

    const duplicateBank = allBanks.find((bank) => {
      const existingKey = normalizeStoredShortcutKey(bank.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicateBank) {
      setShortcutError(`"${nextKey}" is already assigned to bank "${duplicateBank.name}".`);
      return;
    }

    const duplicatePad = bankPads.find((p) => {
      if (p.id === pad.id) return false;
      const existingKey = normalizeStoredShortcutKey(p.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicatePad) {
      setShortcutError(`"${nextKey}" is already assigned to "${duplicatePad.name}".`);
      return;
    }

    setShortcutKey(nextKey);
    setShortcutError(null);
    setMidiError(null);
  };

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();

    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape') {
      applyShortcutKey(null);
      return;
    }

    if (event.shiftKey) {
      setShortcutError('Shift is reserved for the secondary bank.');
      return;
    }
    if (event.ctrlKey) {
      setShortcutError('Ctrl shortcuts are reserved by the browser. Use Alt or Meta instead.');
      return;
    }

    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      code: event.code
    });
    if (!normalized) {
      setShortcutError('Please press a letter or number key.');
      return;
    }

    applyShortcutKey(normalized);
  };

  const handleSave = async () => {
    try {
      if (shortcutError) {
        setUploadError(shortcutError);
        return false;
      }
      const trimmedName = name.slice(0, 32);

      const updatedPad: PadData = {
        ...pad,
        name: trimmedName,
        color,
        triggerMode,
        playbackMode,
        volume: volume[0] / 100,
        fadeInMs: fadeInMs[0],
        fadeOutMs: fadeOutMs[0],
        startTimeMs: startTimeMs[0],
        endTimeMs: endTimeMs[0],
        pitch: pitch[0],
        imageUrl,
        imageData,
        shortcutKey: shortcutKey || undefined,
        midiNote,
        midiCC,
        ignoreChannel
      };
      
      await onSave(updatedPad);
      setName(trimmedName);
      initialSnapshotRef.current = JSON.stringify({
        name: trimmedName,
        color,
        triggerMode,
        playbackMode,
        volume: volume[0] / 100,
        startTimeMs: startTimeMs[0],
        endTimeMs: endTimeMs[0],
        fadeInMs: fadeInMs[0],
        fadeOutMs: fadeOutMs[0],
        pitch: pitch[0],
        imageUrl,
        imageData,
        shortcutKey: shortcutKey || '',
        midiNote: midiNote ?? null,
        midiCC: midiCC ?? null,
        ignoreChannel
      });
      return true;
    } catch (error) {
      console.error('Failed to save pad:', error);
      if (error instanceof Error) {
        setUploadError(error.message);
      } else {
        setUploadError('Failed to save pad changes. Please try again.');
      }
      return false;
    }
  };

  const handleSaveAndClose = React.useCallback(async () => {
    if (isUploading) return;
    const saved = await handleSave();
    if (saved) {
      onOpenChange(false);
    }
  }, [handleSave, onOpenChange, isUploading]);

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    onOpenChange(nextOpen);
  }, [isDirty, onOpenChange]);

  const handleContentKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'button') return;
    event.preventDefault();
    handleSaveAndClose();
  }, [handleSaveAndClose]);

  const handleUnloadClick = () => {
    setShowUnloadConfirm(true);
  };

  const handleConfirmUnload = () => {
    onUnload();
    setShowUnloadConfirm(false);
  };

  const handleDoubleClickReset = (setter: (value: number[]) => void, defaultValue: number) => {
    return () => setter([defaultValue]);
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${seconds}.${milliseconds.toString().padStart(2, '0')}s`;
  };

  const reservedKeysText = RESERVED_SHORTCUT_KEYS.join(', ');

  // Calculate effective playback duration after start/end time adjustments
  const effectiveDuration = endTimeMs[0] - startTimeMs[0];
  // Max fade is 5 seconds or half of trimmed duration, whichever is smaller
  // But ensure minimum 10ms effective duration for fades
  const maxFadeTime = effectiveDuration > 10 ? Math.min(5000, Math.floor(effectiveDuration / 2)) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-lg max-h-[80vh] overflow-y-auto backdrop-blur-md bg-white/95 border-gray-300 dark:bg-gray-800/95 dark:border-gray-600"
          aria-describedby={undefined}
          onKeyDown={handleContentKeyDown}
        > 
          <DialogHeader>
            <DialogTitle>Edit Pad Settings</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {uploadError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {uploadError}
              </div>
            )}

            

            {/* Image Upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Pad Image</Label>
                <Button
                  onClick={handleSaveAndClose}
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                >
                  {isUploading ? 'Saving...' : 'Save'}
                </Button>
              </div>
              {imageUrl ? (
                <div className="flex items-center gap-2">
                  <img 
                    src={imageUrl} 
                    alt="Pad preview" 
                    className="w-16 h-16 object-cover rounded border"
                  />
                  <div className="flex-1">
                    <p className="text-sm text-gray-600 mb-2">Image uploaded</p>
                    <Button 
                      onClick={handleRemoveImage} 
                      variant="outline" 
                      size="sm"
                      disabled={isUploading}
                    >
                      Remove Image
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isUploading}
                  />
                  <Button 
                    onClick={() => imageInputRef.current?.click()}
                    variant="outline"
                    className="w-full"
                    disabled={isUploading}
                  >
                    <ImageIcon className="w-4 h-4 mr-2" />
                    {isUploading ? 'Uploading...' : 'Upload Image (JPG/PNG/WebP)'}
                  </Button>
                </>
              )}
              <p className="text-xs text-gray-500">
                It will replace the pad name display. Maximum: 1024x1024px, 2MB
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Pad Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 32))}
                placeholder="Enter pad name"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                maxLength={32}
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 1800) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>

            <div className={`grid gap-3 ${midiEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="space-y-2">
                <Label htmlFor="shortcutKey">Keyboard Shortcut</Label>
                <Input
                  id="shortcutKey"
                  value={shortcutKey}
                  onKeyDown={handleShortcutKeyDown}
                  placeholder="Press a key"
                  readOnly
                />
                {shortcutError && (
                  <p className="text-xs text-red-500">{shortcutError}</p>
                )}
                {!shortcutError && (
                  <p className="text-xs text-gray-500">
                    Reserved keys: {reservedKeysText}
                  </p>
                )}
              </div>

              {midiEnabled && (
                <div className="space-y-2">
                  <Label>MIDI Assignment</Label>
                  <div className="text-xs text-gray-500">
                    Note: {midiNote ?? '—'} | CC: {midiCC ?? '—'}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMidiLearnActive(true)}
                      className="flex-1"
                    >
                      {midiLearnActive ? 'Listening…' : 'Learn MIDI'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMidiNote(undefined);
                        setMidiCC(undefined);
                        setMidiLearnActive(false);
                        setMidiError(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  {midiError && <p className="text-xs text-red-500">{midiError}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Pad Color</Label>
              <div className="flex gap-1 flex-wrap">
                {(showAllColors ? [...primaryPadColors, ...extraPadColors] : primaryPadColors).map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => setColor(colorOption.value)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      color === colorOption.value ? 'border-white scale-110' : 'border-gray-400'
                    }`}
                    style={{ backgroundColor: colorOption.value }}
                    title={colorOption.label}
                  />
                ))}
              </div>
              {extraPadColors.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[10px]"
                  onClick={() => setShowAllColors((prev) => !prev)}
                >
                  {showAllColors ? 'Show Less' : 'Load More'}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Trigger Mode</Label>
                <Select value={triggerMode} onValueChange={(value: any) => setTriggerMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="toggle">On/Off - Click to play/pause</SelectItem>
                    <SelectItem value="hold">Hold - Play while pressed</SelectItem>
                    <SelectItem value="stutter">Stutter - Restart on each click</SelectItem>
                    <SelectItem value="unmute">Unmute - Play continuously, mute when released</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Playback Mode</Label>
                <Select value={playbackMode} onValueChange={(value: any) => setPlaybackMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Play Once</SelectItem>
                    <SelectItem value="loop">Loop</SelectItem>
                    <SelectItem value="stopper">Stopper - Play and stop all other pads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label 
                  className="cursor-pointer" 
                  onDoubleClick={handleDoubleClickReset(setVolume, 100)}
                  title="Double-click to reset to 100%"
                >
                  Volume: {volume[0]}%
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="ignoreChannel"
                    type="checkbox"
                    checked={ignoreChannel}
                    onChange={(event) => setIgnoreChannel(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="ignoreChannel">Ignore Channel</Label>
                </div>
              </div>
              <Slider
                value={volume}
                onValueChange={setVolume}
                max={100}
                min={0}
                step={1}
                className="w-full cursor-pointer"
                onDoubleClick={handleDoubleClickReset(setVolume, 100)}
              />
            </div>

            {audioDuration > 0 && pad.audioUrl && (
              <>
                <div className="space-y-2">
                  <Label>Trim In / Trim Out</Label>
                  <WaveformTrim
                    audioUrl={pad.audioUrl}
                    startTimeMs={startTimeMs[0]}
                    endTimeMs={endTimeMs[0]}
                    durationMs={audioDuration}
                    onStartTimeChange={(ms) => setStartTimeMs([ms])}
                    onEndTimeChange={(ms) => setEndTimeMs([ms])}
                  />
                </div>

                {/* Fade In Control */}
                <div className="space-y-2">
                  <Label 
                    className="cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setFadeInMs, 0)}
                    title="Double-click to reset to 0ms"
                  >
                    Fade In: {fadeInMs[0]}ms
                  </Label>
                  <Slider
                    value={fadeInMs}
                    onValueChange={(value) => {
                      // Ensure fade in doesn't exceed available duration
                      const clamped = Math.min(value[0], maxFadeTime);
                      setFadeInMs([clamped]);
                    }}
                    max={maxFadeTime}
                    min={0}
                    step={10}
                    className="w-full cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setFadeInMs, 0)}
                    disabled={maxFadeTime <= 0}
                  />
                  <p className="text-xs text-gray-500">
                    {maxFadeTime > 0 
                      ? `Gradual volume increase at playback start (max ${maxFadeTime}ms)`
                      : 'Adjust trim settings to enable fade in'
                    }
                  </p>
                </div>

                {/* Fade Out Control */}
                <div className="space-y-2">
                  <Label 
                    className="cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setFadeOutMs, 0)}
                    title="Double-click to reset to 0ms"
                  >
                    Fade Out: {fadeOutMs[0]}ms
                  </Label>
                  <Slider
                    value={fadeOutMs}
                    onValueChange={(value) => {
                      // Ensure fade out doesn't exceed available duration
                      const clamped = Math.min(value[0], maxFadeTime);
                      setFadeOutMs([clamped]);
                    }}
                    max={maxFadeTime}
                    min={0}
                    step={10}
                    className="w-full cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setFadeOutMs, 0)}
                    disabled={maxFadeTime <= 0}
                  />
                  <p className="text-xs text-gray-500">
                    {maxFadeTime > 0 
                      ? `Gradual volume decrease before playback end (max ${maxFadeTime}ms)`
                      : 'Adjust trim settings to enable fade out'
                    }
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label 
                className="cursor-pointer"
                onDoubleClick={handleDoubleClickReset(setPitch, 0)}
                title="Double-click to reset to 0"
              >
                Pitch: {pitch[0] > 0 ? '+' : ''}{pitch[0]} semitones
              </Label>
              <Slider
                value={pitch}
                onValueChange={setPitch}
                max={12}
                min={-12}
                step={1}
                className="w-full cursor-pointer"
                onDoubleClick={handleDoubleClickReset(setPitch, 0)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-4">
              <Button 
                onClick={handleSaveAndClose} 
                className="w-full"
                disabled={isUploading}
              >
                {isUploading ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button 
                onClick={() => handleDialogOpenChange(false)}
                variant="outline"
                disabled={isUploading}
                className="w-full"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUnloadClick} 
                variant="destructive"
                disabled={isUploading}
                className="w-full"
              >
                Unload
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unload Confirmation Dialog */}
      <ConfirmationDialog
        open={showUnloadConfirm}
        onOpenChange={setShowUnloadConfirm}
        title="Unload Pad"
        description={`Are you sure you want to unload the pad "${name}"? This will permanently remove the pad and its audio. This action cannot be undone.`}
        confirmText="Unload Pad"
        variant="destructive"
        onConfirm={handleConfirmUnload}
      />

      <Dialog open={showUnsavedConfirm} onOpenChange={setShowUnsavedConfirm}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            You have unsaved changes for this pad. Save them or discard the changes.
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => {
                setShowUnsavedConfirm(false);
                handleSaveAndClose();
              }}
              className="flex-1"
              disabled={isUploading}
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setShowUnsavedConfirm(false);
                onOpenChange(false);
              }}
              variant="outline"
              className="flex-1"
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
