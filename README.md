# VDJV Sampler Pad

A professional DJ sampler pad application with advanced audio controls, bank management, and real-time audio processing capabilities.

## 🎵 Features

- **Multi-bank Management**: Organize samples into banks with custom colors
- **Advanced Audio Controls**: Volume, pitch, fade-in/out, EQ, and filter effects
- **Real-time Playback**: Low-latency audio playback with Web Audio API
- **Cross-platform**: Works on desktop, mobile, and as a PWA
- **Offline Support**: Full functionality without internet connection
- **Cloud Sync**: Optional cloud storage and sharing
- **iOS/Android Support**: Native app experience with Capacitor
- **Desktop App**: Electron-based desktop application

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Modern browser with Web Audio API support

### Installation

```bash
# Clone repository
git clone <repository-url>
cd vdjv-sampler-pad

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000 in your browser
```

### Environment Setup

Create `.env.local` file:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 📱 Platform Support

### Web (PWA)
```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Desktop (Electron)
```bash
# Build desktop app
npm run build:electron

# Package for distribution
npm run dist
```

### Mobile (Capacitor)
```bash
# Initialize Capacitor
npm run cap:init

# Add platforms
npm run cap:add:android
npm run cap:add:ios

# Build and sync
npm run cap:sync

# Open in native IDEs
npm run cap:open:android
npm run cap:open:ios
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui
```

## 🛠️ Development

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build

# Testing
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage

# Code Quality
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues
npm run type-check   # Run TypeScript type check

# Platform-specific
npm run build:electron    # Build Electron app
npm run dist             # Package Electron app
npm run cap:sync         # Sync Capacitor
```

### Project Structure

```
client/
├── src/
│   ├── components/
│   │   ├── sampler/          # Main sampler components
│   │   ├── auth/             # Authentication components
│   │   └── ui/               # Reusable UI components
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utility functions
│   ├── test/                 # Test files
│   └── types/                # TypeScript type definitions
├── public/                   # Static assets
└── index.html               # Entry point
```

## 🎛️ Usage

### Basic Operation

1. **Create a Bank**: Click "Add Bank" and give it a name and color
2. **Add Pads**: Click "Add Pad" in a bank to create a new pad
3. **Upload Audio**: Drag and drop audio files or click to browse
4. **Play Pads**: Click on pads to play/pause audio
5. **Adjust Settings**: Use the mixer to control volume, EQ, and effects

### Advanced Features

- **Dual Mode**: Set primary and secondary banks for quick switching
- **Pad Transfer**: Move pads between banks
- **Import/Export**: Share banks with other users
- **Real-time Effects**: Apply fade-in/out, pitch, and filter effects
- **Global Controls**: Master volume, mute, and EQ settings

### Keyboard Shortcuts

- `Space` - Play/Stop current pad
- `M` - Toggle global mute
- `E` - Toggle edit mode
- `B` - Toggle bank menu
- `V` - Toggle mixer

## 🔧 Configuration

### Audio Settings

- **Sample Rate**: 44.1kHz (configurable)
- **Buffer Size**: 512 samples (optimized for latency)
- **Supported Formats**: MP3, WAV, OGG, AAC
- **Max File Size**: 50MB per audio file

### Storage

- **Local Storage**: Banks and settings
- **IndexedDB**: Large audio files and images
- **Cloud Sync**: Optional Supabase integration

## 🐛 Troubleshooting

### Common Issues

#### Audio Not Playing
1. **iOS Safari**: Tap the screen first to unlock audio
2. **AudioContext Suspended**: Click anywhere to resume
3. **File Format**: Ensure audio file is supported
4. **CORS**: Check if audio files are served correctly

#### Storage Issues
1. **QuotaExceededError**: Large files are stored in IndexedDB
2. **Data Loss**: Use backup/restore functionality
3. **Import Errors**: Check file format and size

#### Performance Issues
1. **Memory Leaks**: Restart the app if needed
2. **Large Files**: Consider compressing audio files
3. **Multiple Audio**: Limit concurrent playback

### Debug Tools

```javascript
// Debug playback manager
window.debugPlaybackManager();

// Debug sampler store
window.debugSamplerStore();

// Performance monitoring
console.log('Audio Stats:', playbackManager.getDebugInfo());
```

## 📚 Documentation

- [Technical Documentation](./docs/TECHNICAL_DOCUMENTATION.md)
- [API Reference](./docs/API_REFERENCE.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript strict mode
- Write tests for new features
- Use ESLint and Prettier
- Follow React best practices
- Document complex functions

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Web Audio API for audio processing
- React and TypeScript for the framework
- Tailwind CSS for styling
- Supabase for backend services
- Capacitor for mobile support
- Electron for desktop support

## 📞 Support

- **Email**: support@vdjv.com
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation**: [Technical Docs](./docs/TECHNICAL_DOCUMENTATION.md)

---

Made with ❤️ for the DJ community
