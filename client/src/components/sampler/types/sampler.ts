export interface PadData {
  id: string;
  name: string;
  audioUrl: string;
  imageUrl?: string; // For pad image display
  imageData?: string; // Base64 encoded image data for persistence
  shortcutKey?: string; // Optional keyboard shortcut
  midiNote?: number; // Optional MIDI note mapping
  midiCC?: number; // Optional MIDI CC mapping
  ignoreChannel?: boolean; // Optional: bypass channel assignment
  color: string;
  triggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
  playbackMode: 'once' | 'loop' | 'stopper';
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  startTimeMs: number;
  endTimeMs: number;
  pitch: number; // -12 to +12 semitones
  position: number; // For drag-and-drop ordering
}

export interface SamplerBank {
  id: string;
  name: string;
  defaultColor: string;
  pads: PadData[];
  createdAt: Date;
  sortOrder: number; // For bank ordering
  sourceBankId?: string; // Original bank id from import file (for duplicate blocking)
  shortcutKey?: string; // Optional keyboard shortcut for bank selection
  midiNote?: number; // Optional MIDI note mapping
  midiCC?: number; // Optional MIDI CC mapping
  // New fields for admin bank management
  isAdminBank?: boolean; // Whether this is an admin-exported bank
  transferable?: boolean; // Whether pads can be transferred from this bank
  exportable?: boolean; // Whether this bank can be exported
  bankMetadata?: BankMetadata; // Metadata for admin banks
  creatorEmail?: string; // Email of the user who created/exported the bank
}

export interface BankMetadata {
  password: boolean; // Whether the bank is password protected
  transferable: boolean; // Whether pads can be transferred from this bank
  exportable?: boolean; // Whether export is allowed for this bank
  bankId?: string; // UUID from database for admin banks
  title?: string; // Bank title from database
  description?: string; // Bank description from database
}

export interface AdminBank {
  id: string; // UUID from database
  title: string;
  description?: string;
  created_by: string;
  created_at: string;
  derived_key: string;
}

export interface UserBankAccess {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
}

export type StopMode = 'fadeout' | 'brake' | 'backspin' | 'filter' | 'instant';

export interface PlayingPadInfo {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  volume: number;
  effectiveVolume?: number; // Runtime volume that may differ from original
  currentMs?: number; // Current playback position
  endMs?: number; // Total duration
  channelId?: number | null;
}

export interface ChannelState {
  channelId: number;
  channelVolume: number;
  pad: PlayingPadInfo | null;
}

export interface AudioControls {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  fadeOutStop: () => void;
  brakeStop: () => void;
  backspinStop: () => void;
  filterStop: () => void;
}
