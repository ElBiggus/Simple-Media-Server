const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const MediaServer = require('./server/mediaServer');
const StorageManager = require('./storage/storageManager');

let mainWindow;
let mediaServer;
let storage;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/ui/index.html');
  
  // Always open dev tools to see errors
 // mainWindow.webContents.openDevTools();
  
  // Log when page is loaded
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
  });
  
  // Log any console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer console: ${message}`);
  });
}

app.whenReady().then(async () => {
  storage = new StorageManager();
  await storage.init();
  
  const config = storage.getConfig();
  mediaServer = new MediaServer(storage);
  
  if (config.autoStart) {
    await mediaServer.start(config.port);
  }
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (mediaServer) {
    mediaServer.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('get-config', async () => {
  return storage.getConfig();
});

ipcMain.handle('update-config', async (event, config) => {
  storage.saveConfig(config);
  return { success: true };
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('start-server', async (event, port) => {
  try {
    await mediaServer.start(port);
    const config = storage.getConfig();
    config.port = port;
    storage.saveConfig(config);
    return { success: true, port };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-server', async () => {
  try {
    mediaServer.stop();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-server-status', async () => {
  return {
    running: mediaServer.isRunning(),
    port: mediaServer.getPort()
  };
});

ipcMain.handle('scan-media', async (event, type, createThumbnails = false) => {
  try {
    console.log(`[Main] Scan request received: type=${type}, createThumbnails=${createThumbnails}`);
    await mediaServer.scanMedia(type, createThumbnails);
    return { success: true };
  } catch (error) {
    console.error('[Main] Scan error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-media-library', async (event, type) => {
  return storage.getMediaLibrary(type);
});

ipcMain.handle('update-media-item', async (event, type, id, updates) => {
  try {
    storage.updateMediaItem(type, id, updates);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-media-folder', async (event, type, folder) => {
  const config = storage.getConfig();
  if (!config.mediaFolders[type]) {
    config.mediaFolders[type] = [];
  }
  if (!config.mediaFolders[type].includes(folder)) {
    config.mediaFolders[type].push(folder);
    storage.saveConfig(config);
  }
  return { success: true };
});

ipcMain.handle('remove-media-folder', async (event, type, folder) => {
  const config = storage.getConfig();
  if (config.mediaFolders[type]) {
    config.mediaFolders[type] = config.mediaFolders[type].filter(f => f !== folder);
    storage.saveConfig(config);
  }
  return { success: true };
});
