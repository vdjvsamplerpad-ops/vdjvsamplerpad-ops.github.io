import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const iconSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const sourceIcon = join(rootDir, 'client', 'public', 'assets', 'icon.png');
const androidResDir = join(rootDir, 'android', 'app', 'src', 'main', 'res');

async function generateIcons() {
  console.log('Generating Android icons from:', sourceIcon);
  
  if (!existsSync(sourceIcon)) {
    throw new Error(`Icon not found at: ${sourceIcon}`);
  }

  // Generate icons for each density
  for (const [folder, size] of Object.entries(iconSizes)) {
    const outputDir = join(androidResDir, folder);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = join(outputDir, 'ic_launcher.png');
    const roundOutputPath = join(outputDir, 'ic_launcher_round.png');
    const foregroundPath = join(outputDir, 'ic_launcher_foreground.png');

    console.log(`Generating ${size}x${size} icons for ${folder}...`);

    // Generate regular icon
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(outputPath);

    // Generate round icon (same as regular for now)
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(roundOutputPath);

    // Generate foreground for adaptive icon (needs to be smaller to fit safe zone)
    const foregroundSize = Math.floor(size * 0.7); // 70% of size for safe zone
    await sharp(sourceIcon)
      .resize(foregroundSize, foregroundSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(foregroundPath);
  }

  console.log('✓ Android icons generated successfully!');
}

generateIcons().catch(console.error);
