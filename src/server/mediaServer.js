const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const MediaScanner = require('../scanner/mediaScanner');

class MediaServer {
  constructor(storage) {
    this.storage = storage;
    this.scanner = new MediaScanner(storage);
    this.app = express();
    this.server = null;
    this.port = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../web')));
  }

  setupRoutes() {
    // API Routes
    this.app.get('/api/library/:type', (req, res) => {
      const type = req.params.type;
      const library = this.storage.getMediaLibrary(type);
      res.json(library);
    });

    this.app.get('/api/playback', (req, res) => {
      const playback = this.storage.getPlayback();
      res.json(playback);
    });

    this.app.post('/api/playback', (req, res) => {
      const { mediaType, mediaId, position, duration } = req.body;
      this.storage.updatePlayback(mediaType, mediaId, position, duration);
      res.json({ success: true });
    });

    this.app.get('/api/progress/:type/:id', (req, res) => {
      const progress = this.storage.getProgress(req.params.type, req.params.id);
      res.json(progress);
    });

    // Media streaming
    this.app.get('/media/:type/:id', (req, res) => {
      const { type, id } = req.params;
      const library = this.storage.getMediaLibrary(type);
      
      let filePath = null;
      
      if (type === 'movies') {
        const movie = library.find(m => m.id === id);
        filePath = movie ? movie.filePath : null;
      } else if (type === 'tv') {
        // Find episode in TV library
        for (const show of library) {
          for (const season of show.seasons) {
            const episode = season.episodes.find(e => e.id === id);
            if (episode) {
              filePath = episode.filePath;
              break;
            }
          }
          if (filePath) break;
        }
      } else if (type === 'music') {
        // Find track in music library
        for (const album of library) {
          const track = album.tracks.find(t => t.id === id);
          if (track) {
            filePath = track.filePath;
            break;
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).send('Media not found');
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': this.getContentType(filePath)
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': this.getContentType(filePath)
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    });

    // Serve thumbnails
    this.app.get('/thumbnails/:filename', (req, res) => {
      const thumbnailPath = path.join(process.cwd(), 'data', 'thumbnails', req.params.filename);
      if (fs.existsSync(thumbnailPath)) {
        res.sendFile(thumbnailPath);
      } else {
        res.status(404).send('Thumbnail not found');
      }
    });

    // Serve web interface
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../web/index.html'));
    });
  }

  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg'
    };
    return types[ext] || 'application/octet-stream';
  }

  async start(port) {
    if (this.server) {
      throw new Error('Server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        this.port = port;
        console.log(`Media server running on port ${port}`);
        resolve();
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = null;
    }
  }

  isRunning() {
    return this.server !== null;
  }

  getPort() {
    return this.port;
  }

  async scanMedia(type, createThumbnails = false) {
    if (type === 'movies') {
      return await this.scanner.scanMovies(createThumbnails);
    } else if (type === 'tv') {
      return await this.scanner.scanTV(createThumbnails);
    } else if (type === 'music') {
      return await this.scanner.scanMusic(createThumbnails);
    }
  }
}

module.exports = MediaServer;
