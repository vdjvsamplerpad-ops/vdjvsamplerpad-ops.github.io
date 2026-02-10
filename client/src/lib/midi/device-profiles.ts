import { getLedVelocity } from '@/lib/led-colors';

export type LedResolution = { color: string; channel: number; velocity: number };

export interface MidiDeviceProfile {
  id: string;
  name: string;
  matches: (deviceName?: string | null) => boolean;
  mapColorToVelocity: (hexColor: string) => number;
  resolveLed: (note: number, desiredColor: string, channel: number) => LedResolution;
}

const genericMapColorToVelocity = (hexColor: string) => getLedVelocity(hexColor);
const genericProfile: MidiDeviceProfile = {
  id: 'generic',
  name: 'Generic (no fixed button colors)',
  matches: () => false,
  mapColorToVelocity: genericMapColorToVelocity,
  resolveLed: (note, desiredColor, channel) => ({
    color: desiredColor,
    channel,
    velocity: genericMapColorToVelocity(desiredColor)
  })
};

const akaiMapColorToVelocity = (hexColor: string) => getLedVelocity(hexColor);
const akaiApcMiniMk2Profile: MidiDeviceProfile = {
  id: 'akai-apc-mini-mk2',
  name: 'Akai APC mini mk2',
  matches: (deviceName?: string | null) => {
    if (!deviceName) return false;
    const name = deviceName.toLowerCase();
    return name.includes('apc mini mk2') || name.includes('akai apc');
  },
  mapColorToVelocity: akaiMapColorToVelocity,
  resolveLed: (note, desiredColor, channel) => {
    const fixed =
      (note >= 0x64 && note <= 0x6b) ? '#ff0000'
        : (note >= 0x70 && note <= 0x77) ? '#00ff00'
          : null;
    if (fixed) {
      return { color: fixed, channel, velocity: 127 };
    }
    return { color: desiredColor, channel, velocity: akaiMapColorToVelocity(desiredColor) };
  }
};

export const midiDeviceProfiles: MidiDeviceProfile[] = [akaiApcMiniMk2Profile, genericProfile];

export const getMidiDeviceProfile = (deviceName?: string | null): MidiDeviceProfile => {
  return midiDeviceProfiles.find((profile) => profile.matches(deviceName)) || akaiApcMiniMk2Profile;
};

export const getMidiDeviceProfileById = (id?: string | null): MidiDeviceProfile => {
  if (!id) return akaiApcMiniMk2Profile;
  return midiDeviceProfiles.find((profile) => profile.id === id) || akaiApcMiniMk2Profile;
};

