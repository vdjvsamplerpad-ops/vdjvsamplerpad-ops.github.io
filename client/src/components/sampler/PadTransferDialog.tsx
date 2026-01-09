import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ArrowRight } from 'lucide-react';
import { PadData } from './types/sampler';

interface PadTransferDialogProps {
  pad: PadData;
  availableBanks: Array<{ id: string; name: string; }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransfer: (targetBankId: string) => void;
  theme?: 'light' | 'dark';
}

export function PadTransferDialog({
  pad,
  availableBanks,
  open,
  onOpenChange,
  onTransfer,
  theme = 'light'
}: PadTransferDialogProps) {
  const [selectedBankId, setSelectedBankId] = React.useState<string>('');

  React.useEffect(() => {
    if (open) {
      setSelectedBankId('');
    }
  }, [open]);

  const handleTransfer = () => {
    if (selectedBankId) {
      onTransfer(selectedBankId);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-md backdrop-blur-md ${
        theme === 'dark' ? 'bg-gray-800/95 border-gray-600' : 'bg-white/95 border-gray-300'
      }`} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
            Transfer Pad
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Current Pad Info */}
          <div className={`p-3 rounded-lg border ${
            theme === 'dark' 
              ? 'bg-gray-700/50 border-gray-600/50' 
              : 'bg-gray-50/50 border-gray-300/50'
          }`}>
            <div className="flex items-center gap-3">
              <div 
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: pad.color }}
              />
              <div className="flex-1 min-w-0">
                <p className={`font-medium truncate ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {pad.name}
                </p>
                <p className={`text-sm ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Volume: {Math.round(pad.volume * 100)}% • Mode: {pad.triggerMode}
                </p>
              </div>
            </div>
          </div>

          {/* Bank Selection */}
          <div className="space-y-2">
            <Label className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              Transfer to Bank:
            </Label>
            <Select value={selectedBankId} onValueChange={setSelectedBankId}>
              <SelectTrigger className="backdrop-blur-sm">
                <SelectValue placeholder="Select destination bank..." />
              </SelectTrigger>
              <SelectContent>
                {availableBanks.map((bank) => (
                  <SelectItem key={bank.id} value={bank.id}>
                    {bank.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableBanks.length === 0 && (
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                No other banks available for transfer.
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleTransfer}
              disabled={!selectedBankId}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Transfer Pad
            </Button>
            <Button
              onClick={handleCancel}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
          </div>

          {selectedBankId && (
            <div className={`p-3 rounded-lg border ${
              theme === 'dark'
                ? 'bg-blue-900/20 border-blue-600/50'
                : 'bg-blue-50/50 border-blue-300/50'
            }`}>
              <p className={`text-sm ${
                theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
              }`}>
                The pad will be moved to "{availableBanks.find(b => b.id === selectedBankId)?.name}" 
                and will adopt that bank's default color.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
