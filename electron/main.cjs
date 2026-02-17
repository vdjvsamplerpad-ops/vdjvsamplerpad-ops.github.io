const { app, BrowserWindow, Menu, screen, shell } = require('electron');
const path = require('path');

let mainWindow;
const isDev = !app.isPackaged;

function setupWindowStateCycle(win) {
  let cycleMode = 'windowed';
  let normalBounds = win.getBounds();

  const captureNormalBounds = () => {
    if (!win.isMaximized() && !win.isFullScreen() && cycleMode !== 'pseudo-fullscreen') {
      normalBounds = win.getBounds();
    }
  };

  win.on('move', captureNormalBounds);
  win.on('resize', captureNormalBounds);

  // Cycle order on maximize button (Windows):
  // windowed -> maximized -> pseudo-fullscreen -> windowed
  win.on('maximize', () => {
    if (cycleMode === 'pseudo-fullscreen') {
      cycleMode = 'windowed';
      const restoreBounds = normalBounds;
      setImmediate(() => {
        if (win.isDestroyed()) return;
        if (win.isMaximized()) win.unmaximize();
        if (restoreBounds) win.setBounds(restoreBounds);
      });
      return;
    }

    if (cycleMode === 'windowed') {
      cycleMode = 'maximized';
    }
  });

  win.on('unmaximize', () => {
    if (cycleMode !== 'maximized') return;
    cycleMode = 'pseudo-fullscreen';
    const { bounds } = screen.getDisplayMatching(win.getBounds());
    setImmediate(() => {
      if (win.isDestroyed()) return;
      win.setBounds(bounds);
    });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  // Remove app menu so Alt doesn't reveal File/Edit/View menu in production usage.
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  const indexPath = path.join(__dirname, '..', 'dist', 'public', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = String(input.key || '').toUpperCase();
    const hasCtrlOrCmd = Boolean(input.control || input.meta);

    // Reserve F11 for app mappings, not Electron fullscreen.
    if (key === 'F11') {
      event.preventDefault();
      return;
    }

    // Keep production users out of DevTools shortcuts.
    if (!isDev) {
      const devtoolsShortcut =
        key === 'F12' ||
        (hasCtrlOrCmd && input.shift && (key === 'I' || key === 'J')) ||
        (hasCtrlOrCmd && key === 'U');
      if (devtoolsShortcut) event.preventDefault();
    }
  });

  setupWindowStateCycle(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});

app.whenReady().then(createMainWindow);



