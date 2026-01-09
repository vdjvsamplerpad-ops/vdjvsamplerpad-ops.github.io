import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';

interface EditModeToggleProps {
  editMode: boolean;
  onToggle: (editMode: boolean) => void;
}

export function EditModeToggle({ editMode, onToggle }: EditModeToggleProps) {
  const handleToggle = () => {
    onToggle(!editMode);
  };

  return (
    <Button
      onClick={handleToggle}
      variant={editMode ? 'default' : 'outline'}
      className={editMode ? 'bg-orange-600 hover:bg-orange-500' : ''}
    >
      <Settings className="w-4 h-4 mr-2" />
      {editMode ? 'Exit Edit Mode' : 'Edit Mode'}
    </Button>
  );
}