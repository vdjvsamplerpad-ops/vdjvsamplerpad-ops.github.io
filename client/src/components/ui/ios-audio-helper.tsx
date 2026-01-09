import React from 'react';
import { AlertTriangle, Volume2, VolumeX, Settings, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { getIOSAudioService } from '../../lib/ios-audio-service';
import { useTheme } from '../sampler/hooks/useTheme';

interface IOSAudioHelperProps {
  isVisible: boolean;
  onClose: () => void;
}

export function IOSAudioHelper({ isVisible, onClose }: IOSAudioHelperProps) {
  const { theme } = useTheme();
  const [audioState, setAudioState] = React.useState({
    isUnlocked: false,
    isRingerBypassed: false,
    contextState: 'unknown',
    failureCount: 0
  });
  
  const [isUnlocking, setIsUnlocking] = React.useState(false);
  const iosService = React.useMemo(() => getIOSAudioService(), []);

  React.useEffect(() => {
    if (!isVisible) return;

    const updateState = () => {
      if (iosService) {
        const state = iosService.getState();
        setAudioState({
          isUnlocked: iosService.isUnlocked(),
          isRingerBypassed: iosService.isRingerBypassed(),
          contextState: state.contextState,
          failureCount: state.failureCount
        });
      }
    };

    updateState();
    const interval = setInterval(updateState, 1000);
    return () => clearInterval(interval);
  }, [isVisible, iosService]);

  const handleForceUnlock = async () => {
    setIsUnlocking(true);
    try {
      if (iosService) {
        const success = await iosService.forceUnlock();
        if (success) {
          console.log('✅ iOS audio unlocked successfully');
        } else {
          console.log('❌ iOS audio unlock failed');
        }
      }
    } catch (error) {
      console.error('iOS unlock error:', error);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleDebug = () => {
    try {
      // Call the global debug function
      if ((window as any).debugIOSAudio) {
        (window as any).debugIOSAudio();
        console.log('iOS debug info logged to console');
      } else {
        console.log('Debug function not available');
      }
    } catch (error) {
      console.error('Debug error:', error);
    }
  };

  const handleClose = () => {
    // Always allow closing, even if unlocking
    onClose();
  };

  const getTroubleshootingSteps = () => {
    const steps = [];

    if (!audioState.isUnlocked) {
      steps.push({
        icon: <Volume2 className="w-4 h-4" />,
        title: "Unlock Audio Context",
        description: "Tap the button below to unlock iOS audio playback",
        action: handleForceUnlock,
        actionText: "Unlock Audio",
        critical: true
      });
    }

    if (!audioState.isRingerBypassed) {
      steps.push({
        icon: <VolumeX className="w-4 h-4" />,
        title: "Silent Switch Issue",
        description: "Your device's silent switch may be affecting audio. This will be automatically bypassed.",
        critical: false
      });
    }

    if (audioState.failureCount > 0) {
      steps.push({
        icon: <RefreshCw className="w-4 h-4" />,
        title: "Audio System Recovery",
        description: `Detected ${audioState.failureCount} unlock failures. Consider reloading the page.`,
        action: () => window.location.reload(),
        actionText: "Reload Page",
        critical: true
      });
    }

    return steps;
  };

  const getStatusColor = () => {
    if (audioState.isUnlocked && audioState.isRingerBypassed) return 'text-green-600';
    if (audioState.failureCount > 2) return 'text-red-600';
    return 'text-yellow-600';
  };

  if (!isVisible) return null;

  const troubleshootingSteps = getTroubleshootingSteps();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className={`w-full max-w-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white'}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            iOS Audio Setup
          </CardTitle>
          <CardDescription>
            iOS requires special setup for audio playback in web apps
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Current Status */}
          <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}`}>
            <h4 className="font-medium text-sm mb-2">Current Status</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Audio Context:</span>
                <span className={getStatusColor()}>{audioState.contextState}</span>
              </div>
              <div className="flex justify-between">
                <span>Unlocked:</span>
                <span className={audioState.isUnlocked ? 'text-green-600' : 'text-red-600'}>
                  {audioState.isUnlocked ? '✅ Yes' : '❌ No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Silent Switch Bypass:</span>
                <span className={audioState.isRingerBypassed ? 'text-green-600' : 'text-yellow-600'}>
                  {audioState.isRingerBypassed ? '✅ Active' : '⏳ Pending'}
                </span>
              </div>
            </div>
          </div>

                     {/* Troubleshooting Steps */}
           {troubleshootingSteps.length > 0 && (
             <div className="space-y-3">
               <h4 className="font-medium text-sm">Troubleshooting Steps</h4>
               {troubleshootingSteps.map((step, index) => (
                 <div 
                   key={index} 
                   className={`p-3 rounded-lg border ${step.critical ? 
                     (theme === 'dark' ? 'border-red-400 bg-red-900/20' : 'border-red-200 bg-red-50') : 
                     (theme === 'dark' ? 'border-yellow-400 bg-yellow-900/20' : 'border-yellow-200 bg-yellow-50')
                   }`}
                 >
                   <div className="flex items-start gap-2">
                     <div className={`mt-0.5 ${step.critical ? 'text-red-600' : 'text-yellow-600'}`}>
                       {step.icon}
                     </div>
                     <div className="flex-1">
                       <h5 className="font-medium text-sm">{step.title}</h5>
                       <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>{step.description}</p>
                       {step.action && (
                         <Button
                           size="sm"
                           variant={step.critical ? "destructive" : "secondary"}
                           className="mt-2"
                           onClick={step.action}
                           disabled={isUnlocking}
                         >
                           {isUnlocking && step.actionText === "Unlock Audio" ? (
                             <>
                               <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                               Unlocking...
                             </>
                           ) : (
                             step.actionText
                           )}
                         </Button>
                       )}
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           )}

           {/* General iOS Tips */}
           <div className="space-y-2">
             <h4 className="font-medium text-sm">iOS Audio Tips</h4>
             <div className={`text-xs space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
               <p>• Make sure your volume is turned up</p>
               <p>• Check that silent mode is off (switch above volume buttons)</p>
               <p>• Close the Control Center if audio controls appear there</p>
               <p>• Try locking and unlocking your device if audio stops</p>
               <p>• Reload the page if problems persist</p>
             </div>
           </div>

           {/* Debug Information */}
           <div className="space-y-2">
             <h4 className="font-medium text-sm">Debug Information</h4>
             <div className={`text-xs font-mono p-2 rounded overflow-x-auto ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}`}>
               <div>Context: {audioState.contextState}</div>
               <div>Failures: {audioState.failureCount}</div>
               <div>UA: {navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.userAgent.includes('iPad') ? 'iPad' : 'Other'}</div>
             </div>
           </div>

           {/* Action Buttons */}
           <div className="flex gap-2 pt-4">
             <Button
               size="sm"
               variant="outline"
               onClick={handleDebug}
               className="flex-1"
             >
               <Settings className="w-3 h-3 mr-1" />
               Debug
             </Button>
             
             <Button
               size="sm"
               onClick={handleClose}
               className="flex-1"
             >
               {audioState.isUnlocked ? 'Continue' : 'Close'}
             </Button>
           </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Hook to automatically show iOS helper when needed
export function useIOSAudioHelper() {
  const [showHelper, setShowHelper] = React.useState(false);
  const [hasShownOnce, setHasShownOnce] = React.useState(false);

  React.useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS || hasShownOnce) return;

    const checkAudioState = () => {
      const iosService = getIOSAudioService();
      if (iosService && !iosService.isUnlocked()) {
        setShowHelper(true);
      }
    };

    // Check on first user interaction
    const events = ['touchstart', 'click', 'mousedown'];
    const handleUserInteraction = () => {
      setTimeout(checkAudioState, 1000); // Small delay to let unlock attempt complete
      events.forEach(event => document.removeEventListener(event, handleUserInteraction));
    };

    events.forEach(event => document.addEventListener(event, handleUserInteraction, { once: true }));

    return () => {
      events.forEach(event => document.removeEventListener(event, handleUserInteraction));
    };
  }, [hasShownOnce]);

  const hideHelper = () => {
    setShowHelper(false);
    setHasShownOnce(true);
  };

  return {
    showHelper,
    hideHelper,
    IOSAudioHelper: (props: Omit<IOSAudioHelperProps, 'isVisible' | 'onClose'>) => (
      <IOSAudioHelper {...props} isVisible={showHelper} onClose={hideHelper} />
    )
  };
}
