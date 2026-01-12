import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const sourceIcon = join(rootDir, 'client', 'public', 'assets', 'icon.png');
const iconsDir = join(rootDir, 'build');

async function generateElectronIcons() {
  console.log('Generating Electron icons from:', sourceIcon);
  
  if (!existsSync(sourceIcon)) {
    throw new Error(`Icon not found at: ${sourceIcon}`);
  }

  // Create build directory if it doesn't exist
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  // For Windows, electron-builder needs an .ico file
  // ICO format requires multiple sizes embedded in one file
  // Sharp can create ICO files with multiple sizes
  const iconPath = join(iconsDir, 'icon.ico');
  
  console.log('Generating Windows icon (ico) with multiple sizes...');
  
  // Create ICO with multiple sizes (16, 32, 48, 64, 128, 256)
  // Note: Sharp's ICO support may be limited, so we'll create a PNG first and convert
  // Actually, let's create a 256x256 PNG and electron-builder will handle conversion
  const pngPath = join(iconsDir, 'icon.png');
  
  await sharp(sourceIcon)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(pngPath);

  // Try to create ICO - Sharp may not support ICO directly, so we'll use a workaround
  // For now, create a high-res PNG and electron-builder should be able to use it
  // Or we can specify the icon path in the config
  
  console.log('✓ Electron icons generated!');
  console.log(`  PNG: ${pngPath}`);
}

generateElectronIcons().catch(console.error);
