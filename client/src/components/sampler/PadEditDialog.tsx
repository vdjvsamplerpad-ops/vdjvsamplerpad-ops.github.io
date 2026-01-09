import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { PadData } from './types/sampler';
import { WaveformTrim } from './WaveformTrim';

interface PadEditDialogProps {
  pad: PadData;
  allPads?: PadData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pad: PadData) => void;
  onUnload: () => void;
}

const colorOptions = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Lime', value: '#84cc16' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Sky', value: '#0ea5e9' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Fuchsia', value: '#d946ef' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Black', value: '#1f2937' },
  { label: 'White', value: '#f9fafb' },
];

export function PadEditDialog({ pad, allPads = [], open, onOpenChange, onSave, onUnload }: PadEditDialogProps) {
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
  const [audioDuration, setAudioDuration] = React.useState(0);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [showUnloadConfirm, setShowUnloadConfirm] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

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
      setUploadError(null);

      if (pad.audioUrl) {
        const audio = new Audio(pad.audioUrl);
        audio.addEventListener('loadedmetadata', () => {
          setAudioDuration(audio.duration * 1000);
          if (endTimeMs[0] === 0) {
            setEndTimeMs([audio.duration * 1000]);
          }
        });
      }
    }
  }, [open, pad]);

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

  const handleSave = async () => {
    try {
      const updatedPad: PadData = {
        ...pad,
        name,
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
      };
      
      await onSave(updatedPad);
    } catch (error) {
      console.error('Failed to save pad:', error);
      if (error instanceof Error) {
        setUploadError(error.message);
      } else {
        setUploadError('Failed to save pad changes. Please try again.');
      }
    }
  };

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

  // Calculate effective playback duration after start/end time adjustments
  const effectiveDuration = endTimeMs[0] - startTimeMs[0];
  // Max fade is 5 seconds or half of trimmed duration, whichever is smaller
  // But ensure minimum 10ms effective duration for fades
  const maxFadeTime = effectiveDuration > 10 ? Math.min(5000, Math.floor(effectiveDuration / 2)) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" aria-describedby={undefined}> 
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
              <Label>Pad Image</Label>
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
                When image is uploaded, it will replace the pad name display. Maximum: 1024x1024px, 2MB
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Pad Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter pad name"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 1800) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Pad Color</Label>
              <div className="flex gap-1 flex-wrap">
                {colorOptions.map((colorOption) => (
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
            </div>

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

            <div className="space-y-2">
              <Label 
                className="cursor-pointer" 
                onDoubleClick={handleDoubleClickReset(setVolume, 100)}
                title="Double-click to reset to 100%"
              >
                Volume: {volume[0]}%
              </Label>
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

            <div className="flex gap-2 pt-4">
              <Button 
                onClick={handleSave} 
                className="flex-1"
                disabled={isUploading}
              >
                {isUploading ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button 
                onClick={handleUnloadClick} 
                variant="destructive"
                disabled={isUploading}
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
    </>
  );
}
