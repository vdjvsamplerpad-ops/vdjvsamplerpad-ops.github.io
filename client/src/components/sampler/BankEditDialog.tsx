import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Trash2, Download, Crown } from 'lucide-react';
import { SamplerBank } from './types/sampler';
import { useAuth } from '@/hooks/useAuth';

interface BankEditDialogProps {
  bank: SamplerBank;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  onSave: (updates: Partial<SamplerBank>) => void;
  onDelete: () => void;
  onExport: () => void;
  onExportAdmin?: (id: string, title: string, description: string, transferable: boolean, onProgress?: (progress: number) => void) => Promise<void>;
}

const colorOptions = [
  { label: 'Red', value: '#ef4444', textColor: '#ffffff' },
  { label: 'Orange', value: '#f97316', textColor: '#ffffff' },
  { label: 'Amber', value: '#f59e0b', textColor: '#ffffff' },
  { label: 'Yellow', value: '#eab308', textColor: '#000000' },
  { label: 'Lime', value: '#84cc16', textColor: '#000000' },
  { label: 'Green', value: '#22c55e', textColor: '#ffffff' },
  { label: 'Emerald', value: '#10b981', textColor: '#ffffff' },
  { label: 'Teal', value: '#14b8a6', textColor: '#ffffff' },
  { label: 'Cyan', value: '#06b6d4', textColor: '#ffffff' },
  { label: 'Sky', value: '#0ea5e9', textColor: '#ffffff' },
  { label: 'Blue', value: '#3b82f6', textColor: '#ffffff' },
  { label: 'Indigo', value: '#6366f1', textColor: '#ffffff' },
  { label: 'Violet', value: '#8b5cf6', textColor: '#ffffff' },
  { label: 'Purple', value: '#a855f7', textColor: '#ffffff' },
  { label: 'Fuchsia', value: '#d946ef', textColor: '#ffffff' },
  { label: 'Pink', value: '#ec4899', textColor: '#ffffff' },
  { label: 'Rose', value: '#f43f5e', textColor: '#ffffff' },
  { label: 'Gray', value: '#6b7280', textColor: '#ffffff' },
  { label: 'Black', value: '#1f2937', textColor: '#ffffff' },
  { label: 'White', value: '#f9fafb', textColor: '#000000' },
];

export function BankEditDialog({ bank, open, onOpenChange, theme, onSave, onDelete, onExport, onExportAdmin }: BankEditDialogProps) {
  const { profile } = useAuth();
  const [name, setName] = React.useState(bank.name);
  const [defaultColor, setDefaultColor] = React.useState(bank.defaultColor);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showAdminExport, setShowAdminExport] = React.useState(false);
  const [adminTitle, setAdminTitle] = React.useState(bank.name);
  const [adminDescription, setAdminDescription] = React.useState('');
  const [adminTransferable, setAdminTransferable] = React.useState(false);
  const [showAdminExportProgress, setShowAdminExportProgress] = React.useState(false);
  const [adminExportProgress, setAdminExportProgress] = React.useState(0);
  const [adminExportStatus, setAdminExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [adminExportError, setAdminExportError] = React.useState<string>('');

  React.useEffect(() => {
    if (open) {
      setName(bank.name);
      setDefaultColor(bank.defaultColor);
      setAdminTitle(bank.name);
      setAdminDescription('');
      setAdminTransferable(false);
    }
  }, [open, bank]);

  const handleSave = () => {
    onSave({
      name,
      defaultColor,
    });
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
  };

  const handleAdminExport = async () => {
    if (!onExportAdmin) return;

    setShowAdminExportProgress(true);
    setAdminExportStatus('loading');
    setAdminExportProgress(0);
    setAdminExportError('');

    try {
      await onExportAdmin(bank.id, adminTitle, adminDescription, adminTransferable, (progress) => {
        setAdminExportProgress(progress);
      });
      setAdminExportStatus('success');
    } catch (error) {
      console.error('Admin export failed:', error);
      setAdminExportStatus('error');
      setAdminExportError(error instanceof Error ? error.message : 'Admin export failed');
    }
  };

  const isAdmin = profile?.role === 'admin';

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Bank</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
 

            <div className="space-y-2">
              <Label>Default Color (for new pads)</Label>
              <div className="flex gap-1 flex-wrap">
                {colorOptions.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => setDefaultColor(colorOption.value)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${defaultColor === colorOption.value ? 'border-white scale-110 shadow-lg' : 'border-gray-400'
                      }`}
                    style={{ 
                      backgroundColor: colorOption.value,
                      color: colorOption.textColor
                    }}
                    title={colorOption.label}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Bank Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  if (e.target.value.length <= 18) {
                    setName(e.target.value);
                  }
                }}
                placeholder="Enter bank name"
                className="backdrop-blur-sm"
                maxLength={24}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Bank Information</Label>
              <div className={`text-sm space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                <div>Created: {formatDate(bank.createdAt)}</div>
                <div>Pads: {bank.pads.length}</div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} className="flex-1">
                Save Changes
              </Button>
              <Button
                onClick={() => {
                  // Disable export if this is an admin-imported bank marked non-exportable
                  if (bank.isAdminBank && bank.exportable === false) {
                    return;
                  }
                  if (isAdmin && onExportAdmin) {
                    setShowAdminExport(true);
                  } else {
                    onExport();
                  }
                }}
                variant="outline"
                className={`px-3 ${bank.isAdminBank && bank.exportable === false ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={isAdmin ? 'Export (admin)' : 'Export'}
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button onClick={onDelete} variant="destructive" className="px-3">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Export Dialog */}
      <Dialog open={showAdminExport} onOpenChange={setShowAdminExport}>
        <DialogContent className={`sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="w-4 h-4" />
              Export as Admin Bank
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="adminTitle">Bank Title</Label>
              <Input
                id="adminTitle"
                value={adminTitle}
                onChange={(e) => setAdminTitle(e.target.value)}
                placeholder="Enter bank title"
                className="backdrop-blur-sm"
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminDescription">Description</Label>
              <textarea
                id="adminDescription"
                value={adminDescription}
                onChange={(e) => setAdminDescription(e.target.value)}
                placeholder="Enter bank description"
                className={`w-full min-h-[80px] p-3 rounded-md border backdrop-blur-sm resize-none ${
                  theme === 'dark' 
                    ? 'bg-gray-700/50 border-gray-600 text-white placeholder-gray-400' 
                    : 'bg-white/50 border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
                maxLength={200}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="adminTransferable">Allow Pad Transfers</Label>
              <Switch
                id="adminTransferable"
                checked={adminTransferable}
                onCheckedChange={setAdminTransferable}
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleAdminExport} className="flex-1" disabled={!adminTitle.trim()}>
                Export Admin Bank
              </Button>
              <Button onClick={() => setShowAdminExport(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Export Progress Dialog */}
      <ProgressDialog
        open={showAdminExportProgress}
        onOpenChange={(open) => {
          setShowAdminExportProgress(open);
          if (!open && adminExportStatus === 'success') {
            setShowAdminExport(false);
          }
        }}
        title="Exporting Admin Bank"
        description="Creating encrypted bank file and updating database..."
        progress={adminExportProgress}
        status={adminExportStatus}
        type="export"
        theme={theme}
        errorMessage={adminExportError}
        onRetry={handleAdminExport}
      />

    </>
  );
}
