import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Square, Volume2, VolumeX } from 'lucide-react';

interface PlaybackControlsProps {
  onStopAll: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export function PlaybackControls({ onStopAll, isMuted, onToggleMute }: PlaybackControlsProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg">
      <Button
        onClick={onStopAll}
        variant="outline"
        size="sm"
        className="text-red-400 border-red-400 hover:bg-red-400 hover:text-white"
      >
        <Square className="w-4 h-4 mr-2" />
        Stop All
      </Button>
      
      <Button
        onClick={onToggleMute}
        variant="outline"
        size="sm"
        className={`${
          isMuted 
            ? 'text-red-400 border-red-400 hover:bg-red-400 hover:text-white' 
            : 'text-green-400 border-green-400 hover:bg-green-400 hover:text-white'
        }`}
      >
        {isMuted ? (
          <>
            <VolumeX className="w-4 h-4 mr-2" />
            Unmute
          </>
        ) : (
          <>
            <Volume2 className="w-4 h-4 mr-2" />
            Mute
          </>
        )}
      </Button>
    </div>
  );
}