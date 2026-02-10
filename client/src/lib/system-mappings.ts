export type SystemAction =
  | 'stopAll'
  | 'mixer'
  | 'editMode'
  | 'mute'
  | 'banksMenu'
  | 'nextBank'
  | 'prevBank'
  | 'upload'
  | 'volumeUp'
  | 'volumeDown'
  | 'padSizeUp'
  | 'padSizeDown'
  | 'importBank'
  | 'toggleTheme'
  | 'activateSecondary'
  | 'midiShift';

export interface ChannelMapping {
  keyUp?: string;
  keyDown?: string;
  keyStop?: string;
  midiCC?: number;
  midiNote?: number;
}

export interface SystemMapping {
  key: string;
  midiNote?: number;
  midiCC?: number;
  color?: string;
}

export interface SystemMappings {
  stopAll: SystemMapping;
  mixer: SystemMapping;
  editMode: SystemMapping;
  mute: SystemMapping;
  banksMenu: SystemMapping;
  nextBank: SystemMapping;
  prevBank: SystemMapping;
  upload: SystemMapping;
  volumeUp: SystemMapping;
  volumeDown: SystemMapping;
  padSizeUp: SystemMapping;
  padSizeDown: SystemMapping;
  importBank: SystemMapping;
  toggleTheme: SystemMapping;
  activateSecondary: SystemMapping;
  midiShift: SystemMapping;
  channelMappings: ChannelMapping[];
  masterVolumeCC?: number;
}

export const DEFAULT_SYSTEM_MAPPINGS: SystemMappings = {
  stopAll: { key: 'Space' },
  mixer: { key: 'M' },
  editMode: { key: 'Z' },
  mute: { key: 'X' },
  banksMenu: { key: 'B' },
  nextBank: { key: '[' },
  prevBank: { key: ']' },
  upload: { key: 'N' },
  volumeUp: { key: 'ArrowUp' },
  volumeDown: { key: 'ArrowDown' },
  padSizeUp: { key: '=' },
  padSizeDown: { key: '-' },
  importBank: { key: 'V' },
  toggleTheme: { key: '`' },
  activateSecondary: { key: 'C' },
  midiShift: { key: '' },
  channelMappings: Array.from({ length: 8 }, () => ({
    keyUp: '',
    keyDown: '',
    keyStop: '',
    midiCC: undefined,
    midiNote: undefined
  })),
  masterVolumeCC: undefined
};

export const SYSTEM_ACTION_LABELS: Record<SystemAction, string> = {
  stopAll: 'Stop All',
  mixer: 'Mixer',
  editMode: 'Edit Mode',
  mute: 'Mute/Unmute',
  banksMenu: 'Banks Menu',
  nextBank: 'Next Bank',
  prevBank: 'Previous Bank',
  upload: 'Upload',
  volumeUp: 'Master Volume +',
  volumeDown: 'Master Volume -',
  padSizeUp: 'Pad Size +',
  padSizeDown: 'Pad Size -',
  importBank: 'Import Bank',
  toggleTheme: 'Dark/Light Mode',
  activateSecondary: 'Activate Secondary Page',
  midiShift: 'MIDI Shift'
};

export const SYSTEM_ACTIONS: SystemAction[] = [
  'stopAll',
  'mixer',
  'editMode',
  'mute',
  'banksMenu',
  'nextBank',
  'prevBank',
  'upload',
  'volumeUp',
  'volumeDown',
  'padSizeUp',
  'padSizeDown',
  'importBank',
  'toggleTheme',
  'activateSecondary',
  'midiShift'
];
