const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MediaScanner {
  constructor(storage) {
    this.storage = storage;
    this.videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    this.audioExtensions = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
  }

  async scanMovies() {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.movies || [];
    const movies = [];

    for (const folder of folders) {
      const files = await this.scanDirectory(folder, this.videoExtensions);
      for (const file of files) {
        const movie = await this.parseMovieFile(file);
        movies.push(movie);
      }
    }

    this.storage.setMediaLibrary('movies', movies);
    return movies;
  }

  async scanTV() {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.tv || [];
    const shows = {};

    for (const folder of folders) {
      const files = await this.scanDirectory(folder, this.videoExtensions);
      for (const file of files) {
        const episode = await this.parseTVFile(file);
        
        if (!shows[episode.showName]) {
          shows[episode.showName] = {
            id: this.generateId(episode.showName),
            name: episode.showName,
            seasons: {}
          };
        }

        const seasonKey = `S${episode.season}`;
        if (!shows[episode.showName].seasons[seasonKey]) {
          shows[episode.showName].seasons[seasonKey] = {
            number: episode.season,
            episodes: []
          };
        }

        shows[episode.showName].seasons[seasonKey].episodes.push({
          id: episode.id,
          number: episode.episode,
          title: episode.title,
          filePath: episode.filePath,
          fileName: episode.fileName
        });
      }
    }

    // Convert to array and sort episodes
    const showsArray = Object.values(shows).map(show => ({
      ...show,
      seasons: Object.values(show.seasons).map(season => ({
        ...season,
        episodes: season.episodes.sort((a, b) => a.number - b.number)
      })).sort((a, b) => a.number - b.number)
    }));

    this.storage.setMediaLibrary('tv', showsArray);
    return showsArray;
  }

  async scanMusic() {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.music || [];
    const { parseFile } = await import('music-metadata');
    const albums = {};
    let skippedFiles = 0;
    let recoveredFiles = 0;

    for (const folder of folders) {
      const files = await this.scanDirectory(folder, this.audioExtensions);
      
      for (const file of files) {
        let metadata = null;
        let parseStrategy = 'default';

        // Strategy 1: Try normal parsing first
        try {
          metadata = await parseFile(file, { duration: true });
        } catch (error1) {
          // Strategy 2: Skip covers (fixes readUInt32LE errors in album art)
          try {
            metadata = await parseFile(file, { 
              duration: true,
              skipCovers: true
            });
            parseStrategy = 'no-covers';
            recoveredFiles++;
          } catch (error2) {
            // Strategy 3: Skip covers and post-headers
            try {
              metadata = await parseFile(file, { 
                duration: true,
                skipCovers: true,
                skipPostHeaders: true
              });
              parseStrategy = 'minimal';
              recoveredFiles++;
            } catch (error3) {
              // Strategy 4: For FLAC, try ignoring errors
              if (file.toLowerCase().endsWith('.flac')) {
                try {
                  metadata = await parseFile(file, {
                    duration: true,
                    skipCovers: true,
                    skipPostHeaders: true,
                    includeChapters: false
                  });
                  parseStrategy = 'flac-recovery';
                  recoveredFiles++;
                } catch (error4) {
                  console.error(`Failed to parse ${file} after all strategies:`, error4.message);
                  skippedFiles++;
                  continue;
                }
              } else {
                console.error(`Failed to parse ${file}:`, error3.message);
                skippedFiles++;
                continue;
              }
            }
          }
        }

        // Only add files that were successfully parsed
        const fileName = path.basename(file, path.extname(file));
        const common = metadata.common || {};
        
        const albumArtist = common.albumartist || common.artist || 'Unknown Artist';
        const album = common.album || 'Unknown Album';
        const albumKey = `${albumArtist}|||${album}`;

        if (!albums[albumKey]) {
          albums[albumKey] = {
            id: this.generateId(albumKey),
            artist: albumArtist,
            album: album,
            year: common.year,
            genre: common.genre ? common.genre[0] : null,
            tracks: []
          };
        }

        albums[albumKey].tracks.push({
          id: this.generateId(file),
          title: common.title || fileName,
          trackNumber: common.track?.no || 0,
          duration: metadata.format?.duration || 0,
          filePath: file
        });
      }
    }

    // Convert to array and sort tracks
    const albumsArray = Object.values(albums).map(album => ({
      ...album,
      tracks: album.tracks.sort((a, b) => a.trackNumber - b.trackNumber)
    }));

    if (recoveredFiles > 0) {
      console.log(`Recovered ${recoveredFiles} files using fallback parsing strategies`);
    }
    if (skippedFiles > 0) {
      console.warn(`Skipped ${skippedFiles} files that could not be parsed with any strategy`);
    }

    this.storage.setMediaLibrary('music', albumsArray);
    return albumsArray;
  }

  async scanDirectory(dir, extensions) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath, extensions);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error.message);
    }
    
    return files;
  }

  async parseMovieFile(filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const sanitized = this.sanitizeFileName(fileName);
    
    // Try to extract year
    const yearMatch = sanitized.match(/\((\d{4})\)|\b(\d{4})\b/);
    const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
    
    // Remove year from title
    let title = sanitized.replace(/\(?\d{4}\)?/g, '').trim();
    
    return {
      id: this.generateId(filePath),
      title: title || fileName,
      originalFileName: fileName,
      year,
      filePath,
      addedDate: Date.now()
    };
  }

  async parseTVFile(filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const sanitized = this.sanitizeFileName(fileName);
    
    // Try to match S##E## or S##E##-E## patterns
    const episodePattern = /S(\d+)E(\d+)/i;
    const match = sanitized.match(episodePattern);
    
    let showName, season, episode, title;
    
    if (match) {
      season = parseInt(match[1]);
      episode = parseInt(match[2]);
      
      // Extract show name (everything before the season/episode)
      showName = sanitized.substring(0, match.index).trim();
      
      // Extract episode title (everything after the season/episode)
      title = sanitized.substring(match.index + match[0].length).trim() || `Episode ${episode}`;
    } else {
      // Fallback: try to parse from filename structure
      showName = sanitized;
      season = 1;
      episode = 0;
      title = fileName;
    }
    
    return {
      id: this.generateId(filePath),
      showName: showName || 'Unknown Show',
      season,
      episode,
      title,
      originalFileName: fileName,
      fileName: sanitized,
      filePath
    };
  }

  sanitizeFileName(fileName) {
    let sanitized = fileName;
    
    // Remove common tags and brackets
    sanitized = sanitized.replace(/\[.*?\]/g, '');
    sanitized = sanitized.replace(/\((?!(\d{4}))[^)]*\)/g, ''); // Keep year in parentheses
    
    // Replace dots and underscores with spaces
    sanitized = sanitized.replace(/[._]/g, ' ');
    
    // Remove common quality indicators
    const qualityTags = /\b(1080p|720p|480p|2160p|4K|HDTV|WEB-?DL|WEB-?RIP|BluRay|BRRip|DVDRip|PROPER|REPACK|x264|x265|HEVC|AAC|AC3|DTS)\b/gi;
    sanitized = sanitized.replace(qualityTags, '');
    
    // Remove extra whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Format season/episode properly
    sanitized = sanitized.replace(/[Ss](\d+)[Ee](\d+)/g, (match, s, e) => {
      return `S${s.padStart(2, '0')}E${e.padStart(2, '0')}`;
    });
    
    return sanitized;
  }

  generateId(input) {
    return crypto.createHash('md5').update(input).digest('hex').substring(0, 16);
  }
}

module.exports = MediaScanner;
