const fs = require('fs').promises;
const path = require('path');

class StorageManager {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.libraryFile = path.join(this.dataDir, 'library.json');
    this.playbackFile = path.join(this.dataDir, 'playback.json');
    
    this.config = null;
    this.library = null;
    this.playback = null;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.loadConfig();
    await this.loadLibrary();
    await this.loadPlayback();
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configFile, 'utf8');
      this.config = JSON.parse(data);
    } catch (error) {
      this.config = {
        port: 3000,
        autoStart: false,
        mediaFolders: {
          movies: [],
          tv: [],
          music: []
        }
      };
      await this.saveConfig(this.config);
    }
  }

  async saveConfig(config) {
    this.config = config;
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
  }

  getConfig() {
    return this.config;
  }

  async loadLibrary() {
    try {
      const data = await fs.readFile(this.libraryFile, 'utf8');
      this.library = JSON.parse(data);
    } catch (error) {
      this.library = {
        movies: [],
        tv: [],
        music: []
      };
      await this.saveLibrary();
    }
  }

  async saveLibrary() {
    await fs.writeFile(this.libraryFile, JSON.stringify(this.library, null, 2));
  }

  getMediaLibrary(type) {
    return type ? this.library[type] : this.library;
  }

  setMediaLibrary(type, data) {
    this.library[type] = data;
    this.saveLibrary();
  }

  updateMediaItem(type, id, updates) {
    const items = this.library[type];
    const index = items.findIndex(item => item.id === id);
    if (index !== -1) {
      this.library[type][index] = { ...items[index], ...updates };
      this.saveLibrary();
    }
  }

  async loadPlayback() {
    try {
      const data = await fs.readFile(this.playbackFile, 'utf8');
      this.playback = JSON.parse(data);
    } catch (error) {
      this.playback = {
        lastPlayed: null,
        progress: {}
      };
      await this.savePlayback();
    }
  }

  async savePlayback() {
    await fs.writeFile(this.playbackFile, JSON.stringify(this.playback, null, 2));
  }

  getPlayback() {
    return this.playback;
  }

  updatePlayback(mediaType, mediaId, position, duration) {
    this.playback.lastPlayed = {
      type: mediaType,
      id: mediaId,
      timestamp: Date.now()
    };
    
    const key = `${mediaType}:${mediaId}`;
    this.playback.progress[key] = {
      position,
      duration,
      lastUpdated: Date.now()
    };
    
    this.savePlayback();
  }

  getProgress(mediaType, mediaId) {
    const key = `${mediaType}:${mediaId}`;
    return this.playback.progress[key] || null;
  }
}

module.exports = StorageManager;
