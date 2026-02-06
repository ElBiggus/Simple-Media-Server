const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

class MediaScanner {
  constructor(storage) {
    this.storage = storage;
    this.videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    this.audioExtensions = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
    this.thumbnailsDir = path.join(process.cwd(), 'data', 'thumbnails');
  }

  async scanMovies(createThumbnails = false) {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.movies || [];
    const movies = [];

    console.log(`[Movies] Scanning with createThumbnails = ${createThumbnails}`);

    if (createThumbnails) {
      await this.ensureThumbnailsDir();
      console.log(`[Movies] Thumbnails directory ready: ${this.thumbnailsDir}`);
    }

    for (const folder of folders) {
      const files = await this.scanDirectory(folder, this.videoExtensions);
      for (const file of files) {
        const movie = await this.parseMovieFile(file);
        
        if (createThumbnails) {
          console.log(`[Movies] Extracting thumbnail for: ${movie.title}`);
          const thumbnailPath = await this.extractVideoFrame(file, movie.id);
          if (thumbnailPath) {
            movie.thumbnail = path.basename(thumbnailPath);
            console.log(`[Movies] Thumbnail created: ${movie.thumbnail}`);
          } else {
            console.log(`[Movies] Failed to create thumbnail for: ${movie.title}`);
          }
        }
        
        movies.push(movie);
      }
    }

    this.storage.setMediaLibrary('movies', movies);
    return movies;
  }

  async scanTV(createThumbnails = false) {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.tv || [];
    const shows = {};

    console.log(`[TV] Scanning with createThumbnails = ${createThumbnails}`);

    if (createThumbnails) {
      await this.ensureThumbnailsDir();
      console.log(`[TV] Thumbnails directory ready: ${this.thumbnailsDir}`);
    }

    for (const folder of folders) {
      const files = await this.scanDirectory(folder, this.videoExtensions);
      for (const file of files) {
        const episode = await this.parseTVFile(file, folder);
        
        if (createThumbnails) {
          console.log(`[TV] Extracting thumbnail for: ${episode.showName} S${episode.season}E${episode.episode}`);
          const thumbnailPath = await this.extractVideoFrame(file, episode.id);
          if (thumbnailPath) {
            episode.thumbnail = path.basename(thumbnailPath);
            console.log(`[TV] Thumbnail created: ${episode.thumbnail}`);
          } else {
            console.log(`[TV] Failed to create thumbnail for episode`);
          }
        }
        
        if (!shows[episode.showName]) {
          shows[episode.showName] = {
            id: this.generateId(episode.showName),
            name: episode.showName,
            seasons: {},
            thumbnail: null
          };
        }

        const seasonKey = `S${episode.season}`;
        if (!shows[episode.showName].seasons[seasonKey]) {
          shows[episode.showName].seasons[seasonKey] = {
            number: episode.season,
            episodes: [],
            thumbnail: null
          };
        }

        shows[episode.showName].seasons[seasonKey].episodes.push({
          id: episode.id,
          number: episode.episode,
          title: episode.title,
          filePath: episode.filePath,
          fileName: episode.fileName,
          thumbnail: episode.thumbnail || null
        });
        
        // Set season thumbnail to first episode thumbnail
        if (!shows[episode.showName].seasons[seasonKey].thumbnail && episode.thumbnail) {
          shows[episode.showName].seasons[seasonKey].thumbnail = episode.thumbnail;
        }
        
        // Set show thumbnail to first episode of season 1 thumbnail
        if (episode.season === 1 && !shows[episode.showName].thumbnail && episode.thumbnail) {
          shows[episode.showName].thumbnail = episode.thumbnail;
        }
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

  async scanMusic(createThumbnails = false) {
    const config = this.storage.getConfig();
    const folders = config.mediaFolders.music || [];
    const { parseFile } = await import('music-metadata');
    const albums = {};
    let skippedFiles = 0;
    let recoveredFiles = 0;

    console.log(`[Music] Scanning with createThumbnails = ${createThumbnails}`);

    if (createThumbnails) {
      await this.ensureThumbnailsDir();
      console.log(`[Music] Thumbnails directory ready: ${this.thumbnailsDir}`);
    }

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
            tracks: [],
            thumbnail: null
          };
          
          // Extract album art for thumbnail if requested and available
          if (createThumbnails && metadata.common?.picture && metadata.common.picture.length > 0) {
            console.log(`[Music] Extracting album art for: ${album} by ${albumArtist}`);
            const thumbnailPath = await this.extractAlbumArt(metadata.common.picture[0], albums[albumKey].id);
            if (thumbnailPath) {
              albums[albumKey].thumbnail = path.basename(thumbnailPath);
              console.log(`[Music] Album art created: ${albums[albumKey].thumbnail}`);
            } else {
              console.log(`[Music] Failed to extract album art`);
            }
          }
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

  async parseTVFile(filePath, libraryRoot) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const sanitized = this.sanitizeFileName(fileName);
    
    // Extract show name and season from folder structure
    const relativePath = path.relative(libraryRoot, filePath);
    const pathParts = relativePath.split(path.sep);
    
    // The first directory after the library root is the show name
    let showName = pathParts.length > 1 ? pathParts[0] : 'Unknown Show';
    let season = null;
    
    // Check if there's a season folder (second directory)
    if (pathParts.length > 2) {
      const secondDir = pathParts[1];
      // Match patterns like "Season 04", "Season 4", "S04", "S4"
      const seasonMatch = secondDir.match(/(?:Season|S)\s*(\d+)/i);
      if (seasonMatch) {
        season = parseInt(seasonMatch[1]);
      }
    }
    
    // Try to match S##E## or S##E##-E## patterns in filename
    const episodePattern = /S(\d+)E(\d+)/i;
    const match = sanitized.match(episodePattern);
    
    let episode, title;
    
    if (match) {
      // If season wasn't found in folder structure, use filename
      if (season === null) {
        season = parseInt(match[1]);
      }
      episode = parseInt(match[2]);
      
      // Extract episode title (everything after the season/episode)
      title = sanitized.substring(match.index + match[0].length).trim() || `Episode ${episode}`;
    } else {
      // Fallback: try to parse episode number from filename
      const episodeOnlyPattern = /(?:E|Episode|Ep)\s*(\d+)/i;
      const episodeMatch = sanitized.match(episodeOnlyPattern);
      
      if (episodeMatch) {
        episode = parseInt(episodeMatch[1]);
        title = sanitized.substring(episodeMatch.index + episodeMatch[0].length).trim() || `Episode ${episode}`;
      } else {
        // Last resort: use filename as title
        episode = 0;
        title = fileName;
      }
      
      // If no season found anywhere, default to 1
      if (season === null) {
        season = 1;
      }
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

  async ensureThumbnailsDir() {
    try {
      await fs.mkdir(this.thumbnailsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create thumbnails directory:', error.message);
    }
  }

  async extractVideoFrame(videoPath, id) {
    return new Promise((resolve) => {
      const thumbnailFilename = `${id}.png`;
      const thumbnailPath = path.join(this.thumbnailsDir, thumbnailFilename);

      // Skip if thumbnail already exists
      if (fsSync.existsSync(thumbnailPath)) {
        console.log(`Thumbnail already exists: ${thumbnailPath}`);
        resolve(thumbnailPath);
        return;
      }

      console.log(`Starting ffmpeg extraction for: ${videoPath}`);
      console.log(`Target thumbnail: ${thumbnailPath}`);

      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['90'], // 90 seconds into the video
          filename: thumbnailFilename,
          folder: this.thumbnailsDir,
          size: '320x180'
        })
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log(`FFmpeg extraction completed: ${thumbnailPath}`);
          resolve(thumbnailPath);
        })
        .on('error', (err) => {
          console.error(`Failed to extract frame from ${videoPath}:`, err.message);
          console.error('Full error:', err);
          resolve(null);
        });
    });
  }

  async extractAlbumArt(picture, albumId) {
    try {
      const thumbnailFilename = `${albumId}.png`;
      const thumbnailPath = path.join(this.thumbnailsDir, thumbnailFilename);

      // Skip if thumbnail already exists
      if (fsSync.existsSync(thumbnailPath)) {
        console.log(`Album art already exists: ${thumbnailPath}`);
        return thumbnailPath;
      }

      console.log(`Writing album art to: ${thumbnailPath}`);
      // Write the picture data to a PNG file
      await fs.writeFile(thumbnailPath, picture.data);
      console.log(`Album art written successfully`);
      return thumbnailPath;
    } catch (error) {
      console.error(`Failed to extract album art:`, error.message);
      console.error('Full error:', error);
      return null;
    }
  }
}

module.exports = MediaScanner;
