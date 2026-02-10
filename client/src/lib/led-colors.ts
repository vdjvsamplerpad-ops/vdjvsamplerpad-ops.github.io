export type LedColor = {
  name: string;
  hex: string;
  velocity: number;
};

export const LED_COLOR_OPTIONS: Array<{ name: string; hex: string }> = [
  { name: 'Red', hex: '#ff0000' },
  { name: 'Orange', hex: '#ff5400' },
  { name: 'Warm Yellow', hex: '#ffbd6c' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Yellow Green', hex: '#bdff2d' },
  { name: 'Lime', hex: '#54ff00' },
  { name: 'Green', hex: '#00ff00' },
  { name: 'Cyan', hex: '#4cc3ff' },
  { name: 'Blue', hex: '#0000ff' },
  { name: 'Purple', hex: '#5400ff' },
  { name: 'Pink', hex: '#ff00ff' },
  { name: 'White', hex: '#ffffff' }
];

export const LED_COLOR_PALETTE: LedColor[] = [
  { velocity: 0, hex: '#000000', name: 'Off' },
  { velocity: 1, hex: '#1e1e1e', name: 'Dim Gray' },
  { velocity: 2, hex: '#7f7f7f', name: 'Gray' },
  { velocity: 3, hex: '#ffffff', name: 'White' },
  { velocity: 4, hex: '#ff4c4c', name: 'Light Red' },
  { velocity: 5, hex: '#ff0000', name: 'Red' },
  { velocity: 6, hex: '#590000', name: 'Dark Red' },
  { velocity: 7, hex: '#190000', name: 'Deep Red' },
  { velocity: 8, hex: '#ffbd6c', name: 'Amber' },
  { velocity: 9, hex: '#ff5400', name: 'Orange' },
  { velocity: 10, hex: '#591d00', name: 'Brown' },
  { velocity: 11, hex: '#271b00', name: 'Deep Brown' },
  { velocity: 12, hex: '#ffff4c', name: 'Light Yellow' },
  { velocity: 13, hex: '#ffff00', name: 'Yellow' },
  { velocity: 14, hex: '#595900', name: 'Olive' },
  { velocity: 15, hex: '#191900', name: 'Deep Olive' },
  { velocity: 16, hex: '#88ff4c', name: 'Light Lime' },
  { velocity: 17, hex: '#54ff00', name: 'Lime' },
  { velocity: 18, hex: '#1d5900', name: 'Dark Green' },
  { velocity: 19, hex: '#142b00', name: 'Deep Green' },
  { velocity: 20, hex: '#4cff4c', name: 'Light Green' },
  { velocity: 21, hex: '#00ff00', name: 'Green' },
  { velocity: 22, hex: '#005900', name: 'Forest Green' },
  { velocity: 23, hex: '#001900', name: 'Deep Forest' },
  { velocity: 24, hex: '#4cff5e', name: 'Mint' },
  { velocity: 25, hex: '#00ff19', name: 'Neon Green' },
  { velocity: 26, hex: '#00590d', name: 'Deep Green 2' },
  { velocity: 27, hex: '#001902', name: 'Deep Green 3' },
  { velocity: 28, hex: '#4cff88', name: 'Sea Green' },
  { velocity: 29, hex: '#00ff55', name: 'Bright Sea' },
  { velocity: 30, hex: '#00591d', name: 'Deep Sea' },
  { velocity: 31, hex: '#001f12', name: 'Deep Sea 2' },
  { velocity: 32, hex: '#4cffb7', name: 'Aqua' },
  { velocity: 33, hex: '#00ff99', name: 'Aqua Green' },
  { velocity: 34, hex: '#005935', name: 'Deep Aqua' },
  { velocity: 35, hex: '#001912', name: 'Deep Aqua 2' },
  { velocity: 36, hex: '#4cc3ff', name: 'Sky' },
  { velocity: 37, hex: '#00a9ff', name: 'Light Blue' },
  { velocity: 38, hex: '#004152', name: 'Deep Sky' },
  { velocity: 39, hex: '#001019', name: 'Deep Sky 2' },
  { velocity: 40, hex: '#4c88ff', name: 'Soft Blue' },
  { velocity: 41, hex: '#0055ff', name: 'Blue' },
  { velocity: 42, hex: '#001d59', name: 'Dark Blue' },
  { velocity: 43, hex: '#000819', name: 'Deep Blue' },
  { velocity: 44, hex: '#4c4cff', name: 'Indigo' },
  { velocity: 45, hex: '#0000ff', name: 'Pure Blue' },
  { velocity: 46, hex: '#000059', name: 'Deep Indigo' },
  { velocity: 47, hex: '#000019', name: 'Deep Indigo 2' },
  { velocity: 48, hex: '#874cff', name: 'Violet' },
  { velocity: 49, hex: '#5400ff', name: 'Purple' },
  { velocity: 50, hex: '#190064', name: 'Deep Purple' },
  { velocity: 51, hex: '#0f0030', name: 'Deep Purple 2' },
  { velocity: 52, hex: '#ff4cff', name: 'Magenta' },
  { velocity: 53, hex: '#ff00ff', name: 'Hot Pink' },
  { velocity: 54, hex: '#590059', name: 'Deep Magenta' },
  { velocity: 55, hex: '#190019', name: 'Deep Magenta 2' },
  { velocity: 56, hex: '#ff4c87', name: 'Pink' },
  { velocity: 57, hex: '#ff0054', name: 'Hot Pink 2' },
  { velocity: 58, hex: '#59001d', name: 'Deep Pink' },
  { velocity: 59, hex: '#220013', name: 'Deep Pink 2' },
  { velocity: 60, hex: '#ff1500', name: 'Orange Red' },
  { velocity: 61, hex: '#993500', name: 'Burnt Orange' },
  { velocity: 62, hex: '#795100', name: 'Gold Brown' },
  { velocity: 63, hex: '#436400', name: 'Olive Green' },
  { velocity: 64, hex: '#033900', name: 'Deep Olive' },
  { velocity: 65, hex: '#005735', name: 'Teal Green' },
  { velocity: 66, hex: '#00547f', name: 'Teal Blue' },
  { velocity: 67, hex: '#0000ff', name: 'Pure Blue 2' },
  { velocity: 68, hex: '#00454f', name: 'Deep Teal' },
  { velocity: 69, hex: '#2500cc', name: 'Deep Violet' },
  { velocity: 70, hex: '#7f7f7f', name: 'Gray 2' },
  { velocity: 71, hex: '#202020', name: 'Dark Gray' },
  { velocity: 72, hex: '#ff0000', name: 'Red 2' },
  { velocity: 73, hex: '#bdff2d', name: 'Yellow Green' },
  { velocity: 74, hex: '#afed06', name: 'Yellow Green 2' },
  { velocity: 75, hex: '#64ff09', name: 'Bright Green' },
  { velocity: 76, hex: '#108b00', name: 'Dark Green 2' },
  { velocity: 77, hex: '#00ff87', name: 'Aqua 2' },
  { velocity: 78, hex: '#00a9ff', name: 'Light Blue 2' },
  { velocity: 79, hex: '#002aff', name: 'Deep Blue 2' },
  { velocity: 80, hex: '#3f00ff', name: 'Violet 2' },
  { velocity: 81, hex: '#7a00ff', name: 'Purple 2' },
  { velocity: 82, hex: '#b21a7d', name: 'Magenta 2' },
  { velocity: 83, hex: '#402100', name: 'Brown 2' },
  { velocity: 84, hex: '#ff4a00', name: 'Orange 2' },
  { velocity: 85, hex: '#88e106', name: 'Lime 2' },
  { velocity: 86, hex: '#72ff15', name: 'Lime 3' },
  { velocity: 87, hex: '#00ff00', name: 'Green 2' },
  { velocity: 88, hex: '#3bff26', name: 'Bright Green 2' },
  { velocity: 89, hex: '#59ff71', name: 'Mint 2' },
  { velocity: 90, hex: '#38ffcc', name: 'Cyan 2' },
  { velocity: 91, hex: '#5b8aff', name: 'Blue 2' },
  { velocity: 92, hex: '#3151c6', name: 'Blue 3' },
  { velocity: 93, hex: '#877fe9', name: 'Purple 3' },
  { velocity: 94, hex: '#d31dff', name: 'Violet 3' },
  { velocity: 95, hex: '#ff005d', name: 'Pink 2' },
  { velocity: 96, hex: '#ff7f00', name: 'Orange 3' },
  { velocity: 97, hex: '#b9b000', name: 'Olive 2' },
  { velocity: 98, hex: '#90ff00', name: 'Lime 4' },
  { velocity: 99, hex: '#835d07', name: 'Gold 2' },
  { velocity: 100, hex: '#392b00', name: 'Deep Gold' },
  { velocity: 101, hex: '#144c10', name: 'Deep Green 4' },
  { velocity: 102, hex: '#0d5038', name: 'Deep Teal' },
  { velocity: 103, hex: '#15152a', name: 'Deep Indigo' },
  { velocity: 104, hex: '#16205a', name: 'Deep Blue 3' },
  { velocity: 105, hex: '#693c1c', name: 'Brown 3' },
  { velocity: 106, hex: '#a8000a', name: 'Dark Red 2' },
  { velocity: 107, hex: '#de513d', name: 'Red 3' },
  { velocity: 108, hex: '#d86a1c', name: 'Orange 4' },
  { velocity: 109, hex: '#ffe126', name: 'Yellow 2' },
  { velocity: 110, hex: '#9ee12f', name: 'Yellow Green 3' },
  { velocity: 111, hex: '#67b50f', name: 'Green 3' },
  { velocity: 112, hex: '#1e1e30', name: 'Deep Gray' },
  { velocity: 113, hex: '#dcff6b', name: 'Pale Yellow' },
  { velocity: 114, hex: '#80ffbd', name: 'Pale Cyan' },
  { velocity: 115, hex: '#9a99ff', name: 'Pale Blue' },
  { velocity: 116, hex: '#8e66ff', name: 'Pale Purple' },
  { velocity: 117, hex: '#404040', name: 'Gray 3' },
  { velocity: 118, hex: '#757575', name: 'Gray 4' },
  { velocity: 119, hex: '#e0ffff', name: 'White 2' },
  { velocity: 120, hex: '#a00000', name: 'Dark Red 3' },
  { velocity: 121, hex: '#350000', name: 'Deep Red 2' },
  { velocity: 122, hex: '#1ad000', name: 'Lime 5' },
  { velocity: 123, hex: '#074200', name: 'Deep Green 5' },
  { velocity: 124, hex: '#b9b000', name: 'Olive 3' },
  { velocity: 125, hex: '#3f3100', name: 'Deep Olive 2' },
  { velocity: 126, hex: '#b35f00', name: 'Orange 5' },
  { velocity: 127, hex: '#4b1502', name: 'Deep Brown 2' }
];

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r, g, b };
};

export const getNearestLedColor = (hex: string): LedColor => {
  const target = hexToRgb(hex);
  let best = LED_COLOR_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of LED_COLOR_PALETTE) {
    const rgb = hexToRgb(candidate.hex);
    const distance =
      (target.r - rgb.r) ** 2 + (target.g - rgb.g) ** 2 + (target.b - rgb.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
};

export const getLedVelocity = (hex: string): number => {
  return getNearestLedColor(hex).velocity;
};
