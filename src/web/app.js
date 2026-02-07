// Simple router
class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = null;
    
    window.addEventListener('popstate', () => {
      this.navigate(window.location.pathname, false);
    });
  }

  addRoute(path, handler) {
    this.routes[path] = handler;
  }

  navigate(path, pushState = true) {
    this.currentRoute = path;
    if (pushState) {
      window.history.pushState({}, '', path);
    }
    
    // Match dynamic routes
    for (const [route, handler] of Object.entries(this.routes)) {
      const pattern = new RegExp('^' + route.replace(/:\w+/g, '([^/]+)') + '$');
      const match = path.match(pattern);
      
      if (match) {
        const params = {};
        const paramNames = (route.match(/:\w+/g) || []).map(p => p.substring(1));
        paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        handler(params);
        return;
      }
    }
    
    // Exact match
    if (this.routes[path]) {
      this.routes[path]();
    }
  }
}

const router = new Router();
const app = document.getElementById('app');

// API helpers
async function fetchAPI(endpoint) {
  const response = await fetch(`/api${endpoint}`);
  return response.json();
}

async function postAPI(endpoint, data) {
  const response = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Home page
router.addRoute('/', async () => {
  const playback = await fetchAPI('/playback');
  
  let resumeHTML = '';
  if (playback.lastPlayed) {
    const { type, id } = playback.lastPlayed;
    const library = await fetchAPI(`/library/${type}`);
    let itemTitle = 'Unknown';
    
    if (type === 'movies') {
      const movie = library.find(m => m.id === id);
      itemTitle = movie ? movie.title : 'Unknown Movie';
    } else if (type === 'tv') {
      // Find episode
      for (const show of library) {
        for (const season of show.seasons) {
          const episode = season.episodes.find(e => e.id === id);
          if (episode) {
            itemTitle = `${show.name} - S${season.number.toString().padStart(2, '0')}E${episode.number.toString().padStart(2, '0')}`;
            break;
          }
        }
      }
    } else if (type === 'music') {
      // Find track
      for (const album of library) {
        const track = album.tracks.find(t => t.id === id);
        if (track) {
          itemTitle = `${track.title} - ${album.artist}`;
          break;
        }
      }
    }
    
    resumeHTML = `
      <div class="resume-card" onclick="resumePlayback('${type}', '${id}')">
        <h3>📺 Resume Playback</h3>
        <p>${itemTitle}</p>
      </div>
    `;
  }
  
  app.innerHTML = `
    <header>
      <div class="container">
        <h1>🎬 Media Server</h1>
        <nav>
          <a href="/movies" class="nav-btn" onclick="route(event, '/movies')">🎥 Movies</a>
          <a href="/tv" class="nav-btn" onclick="route(event, '/tv')">📺 TV Shows</a>
          <a href="/music" class="nav-btn" onclick="route(event, '/music')">🎵 Music</a>
        </nav>
      </div>
    </header>
    <div class="container">
      ${resumeHTML}
      <h2>Welcome to Your Media Server</h2>
      <p style="color: #888; font-size: 1.1em;">Select a category above to browse your collection.</p>
    </div>
  `;
});

// Movies list
router.addRoute('/movies', async () => {
  const movies = await fetchAPI('/library/movies');
  
  app.innerHTML = `
    <header>
      <div class="container">
        <h1>🎥 Movies</h1>
        <nav>
          <a href="/" class="nav-btn" onclick="route(event, '/')">🏠 Home</a>
          <a href="/tv" class="nav-btn" onclick="route(event, '/tv')">📺 TV Shows</a>
          <a href="/music" class="nav-btn" onclick="route(event, '/music')">🎵 Music</a>
        </nav>
      </div>
    </header>
    <div class="container">
      <div class="sort-controls">
        <label style="color: #888;">Sort by:</label>
        <select id="sortSelect" onchange="sortMovies()">
          <option value="title">Title</option>
          <option value="year">Release Date</option>
          <option value="added">Date Added</option>
        </select>
      </div>
      <div class="grid" id="moviesGrid"></div>
    </div>
  `;
  
  window.currentMovies = movies;
  renderMovies(movies);
});

function renderMovies(movies) {
  const grid = document.getElementById('moviesGrid');
  
  if (movies.length === 0) {
    grid.innerHTML = '<div class="empty-state">No movies found. Add some movies in the desktop app.</div>';
    return;
  }
  
  grid.innerHTML = movies.map(movie => {
    const thumbnailSrc = movie.thumbnail ? `/thumbnails/${movie.thumbnail}` : null;
    const imageContent = thumbnailSrc 
      ? `<img src="${thumbnailSrc}" alt="${movie.title}" style="width: 100%; height: 100%; object-fit: cover;">` 
      : '🎬';
    return `
      <div class="card" onclick="router.navigate('/movie/${movie.id}')">
        <div class="card-image">${imageContent}</div>
        <div class="card-content">
          <div class="card-title">${movie.title}</div>
          <div class="card-subtitle">${movie.year || 'Year Unknown'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function sortMovies() {
  const sortBy = document.getElementById('sortSelect').value;
  const movies = [...window.currentMovies];
  
  if (sortBy === 'title') {
    movies.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortBy === 'year') {
    movies.sort((a, b) => (b.year || 0) - (a.year || 0));
  } else if (sortBy === 'added') {
    movies.sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0));
  }
  
  renderMovies(movies);
}

// Movie detail
router.addRoute('/movie/:id', async (params) => {
  const movies = await fetchAPI('/library/movies');
  const movie = movies.find(m => m.id === params.id);
  
  if (!movie) {
    app.innerHTML = '<div class="container"><p>Movie not found</p></div>';
    return;
  }
  
  const progress = await fetchAPI(`/progress/movies/${movie.id}`);
  
  app.innerHTML = `
    <div class="container">
      <a href="/movies" class="back-btn" onclick="route(event, '/movies')">← Back to Movies</a>
      <div class="detail-view">
        <div class="detail-header">
          <div class="detail-poster">${movie.thumbnail ? `<img src="/thumbnails/${movie.thumbnail}" alt="${movie.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` : '🎬'}</div>
          <div class="detail-info">
            <h2>${movie.title}</h2>
            <p>${movie.year ? `Released: ${movie.year}` : 'Release date unknown'}</p>
            <p style="color: #666;">${movie.originalFileName}</p>
            <div>
              <button class="btn" onclick="playMovie('${movie.id}', 0)">▶ Watch from Start</button>
              ${progress ? `<button class="btn btn-secondary" onclick="playMovie('${movie.id}', ${progress.position})">▶ Resume (${formatDuration(progress.position)})</button>` : ''}
            </div>
          </div>
        </div>
        <div id="playerContainer"></div>
      </div>
    </div>
  `;
});

async function playMovie(id, startTime) {
  const container = document.getElementById('playerContainer');
  container.innerHTML = `
    <video id="videoPlayer" controls autoplay>
      <source src="/media/movies/${id}" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  `;
  
  const video = document.getElementById('videoPlayer');
  video.currentTime = startTime;
  
  // Track progress
  video.addEventListener('timeupdate', () => {
    if (video.currentTime > 0 && video.duration > 0) {
      postAPI('/playback', {
        mediaType: 'movies',
        mediaId: id,
        position: video.currentTime,
        duration: video.duration
      });
    }
  });
}

// TV shows list
router.addRoute('/tv', async () => {
  const shows = await fetchAPI('/library/tv');
  
  app.innerHTML = `
    <header>
      <div class="container">
        <h1>📺 TV Shows</h1>
        <nav>
          <a href="/" class="nav-btn" onclick="route(event, '/')">🏠 Home</a>
          <a href="/movies" class="nav-btn" onclick="route(event, '/movies')">🎥 Movies</a>
          <a href="/music" class="nav-btn" onclick="route(event, '/music')">🎵 Music</a>
        </nav>
      </div>
    </header>
    <div class="container">
      <div class="grid" id="showsGrid"></div>
    </div>
  `;
  
  const grid = document.getElementById('showsGrid');
  
  if (shows.length === 0) {
    grid.innerHTML = '<div class="empty-state">No TV shows found. Add some TV shows in the desktop app.</div>';
    return;
  }
  
  grid.innerHTML = shows.map(show => {
    const episodeCount = show.seasons.reduce((sum, s) => s.episodes.length + sum, 0);
    const thumbnailSrc = show.thumbnail ? `/thumbnails/${show.thumbnail}` : null;
    const imageContent = thumbnailSrc 
      ? `<img src="${thumbnailSrc}" alt="${show.name}" style="width: 100%; height: 100%; object-fit: cover;">` 
      : '📺';
    return `
      <div class="card" onclick="router.navigate('/tv/${show.id}')">
        <div class="card-image">${imageContent}</div>
        <div class="card-content">
          <div class="card-title">${show.name}</div>
          <div class="card-subtitle">${show.seasons.length} Seasons • ${episodeCount} Episodes</div>
        </div>
      </div>
    `;
  }).join('');
});

// TV show detail (seasons)
router.addRoute('/tv/:showId', async (params) => {
  const shows = await fetchAPI('/library/tv');
  const show = shows.find(s => s.id === params.showId);
  
  if (!show) {
    app.innerHTML = '<div class="container"><p>Show not found</p></div>';
    return;
  }
  
  app.innerHTML = `
    <div class="container">
      <a href="/tv" class="back-btn" onclick="route(event, '/tv')">← Back to TV Shows</a>
      <div class="detail-view">
        <h2>${show.name}</h2>
        <ul class="season-list">
          ${show.seasons.map(season => {
            const thumbnailSrc = season.thumbnail ? `/thumbnails/${season.thumbnail}` : null;
            const thumbnailHTML = thumbnailSrc 
              ? `<img src="${thumbnailSrc}" alt="Season ${season.number}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px; margin-right: 15px;">` 
              : '';
            return `
              <li class="season-item" onclick="router.navigate('/tv/${show.id}/season/${season.number}')">
                <div style="display: flex; align-items: center;">
                  ${thumbnailHTML}
                  <div>
                    <strong>Season ${season.number}</strong>
                    <span style="color: #888; margin-left: 15px;">${season.episodes.length} episodes</span>
                  </div>
                </div>
                <span>→</span>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    </div>
  `;
});

// Season detail (episodes)
router.addRoute('/tv/:showId/season/:seasonNum', async (params) => {
  const shows = await fetchAPI('/library/tv');
  const show = shows.find(s => s.id === params.showId);
  
  if (!show) {
    app.innerHTML = '<div class="container"><p>Show not found</p></div>';
    return;
  }
  
  const season = show.seasons.find(s => s.number === parseInt(params.seasonNum));
  
  if (!season) {
    app.innerHTML = '<div class="container"><p>Season not found</p></div>';
    return;
  }
  
  app.innerHTML = `
    <div class="container">
      <a href="/tv/${show.id}" class="back-btn" onclick="route(event, '/tv/${show.id}')">← Back to ${show.name}</a>
      <div class="detail-view">
        <h2>${show.name} - Season ${season.number}</h2>
        <ul class="episode-list">
          ${season.episodes.map(episode => {
            const thumbnailSrc = episode.thumbnail ? `/thumbnails/${episode.thumbnail}` : null;
            const thumbnailHTML = thumbnailSrc 
              ? `<img src="${thumbnailSrc}" alt="Episode ${episode.number}" style="width: 120px; height: 68px; object-fit: cover; border-radius: 4px; margin-right: 15px;">` 
              : '';
            return `
              <li class="episode-item" id="episode-${episode.id}" onclick="playEpisode('${episode.id}')">
                <div style="display: flex; align-items: center;">
                  ${thumbnailHTML}
                  <div>
                    <strong>Episode ${episode.number}: ${episode.title}</strong>
                  </div>
                </div>
                <span>▶</span>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    </div>
  `;
});

async function playEpisode(id) {
  // Remove any existing player
  const existingPlayer = document.getElementById('episodePlayerContainer');
  if (existingPlayer) {
    existingPlayer.remove();
  }
  
  // Create player container
  const playerContainer = document.createElement('div');
  playerContainer.id = 'episodePlayerContainer';
  playerContainer.style.cssText = 'margin: 15px 0; padding: 0;';
  playerContainer.innerHTML = `
    <video id="videoPlayer" controls autoplay style="width: 100%; border-radius: 8px;">
      <source src="/media/tv/${id}" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  `;
  
  // Insert the player directly after the clicked episode
  const episodeItem = document.getElementById(`episode-${id}`);
  if (episodeItem) {
    episodeItem.after(playerContainer);
  }
  
  const video = document.getElementById('videoPlayer');
  
  // Track progress
  video.addEventListener('timeupdate', () => {
    if (video.currentTime > 0 && video.duration > 0) {
      postAPI('/playback', {
        mediaType: 'tv',
        mediaId: id,
        position: video.currentTime,
        duration: video.duration
      });
    }
  });
}

// Music list
router.addRoute('/music', async () => {
  const albums = await fetchAPI('/library/music');
  
  app.innerHTML = `
    <header>
      <div class="container">
        <h1>🎵 Music</h1>
        <nav>
          <a href="/" class="nav-btn" onclick="route(event, '/')">🏠 Home</a>
          <a href="/movies" class="nav-btn" onclick="route(event, '/movies')">🎥 Movies</a>
          <a href="/tv" class="nav-btn" onclick="route(event, '/tv')">📺 TV Shows</a>
        </nav>
      </div>
    </header>
    <div class="container">
      <div class="grid" id="albumsGrid"></div>
    </div>
  `;
  
  const grid = document.getElementById('albumsGrid');
  
  if (albums.length === 0) {
    grid.innerHTML = '<div class="empty-state">No music found. Add some music in the desktop app.</div>';
    return;
  }
  
  grid.innerHTML = albums.map(album => {
    const thumbnailSrc = album.thumbnail ? `/thumbnails/${album.thumbnail}` : null;
    const imageContent = thumbnailSrc 
      ? `<img src="${thumbnailSrc}" alt="${album.album}" style="width: 100%; height: 100%; object-fit: cover;">` 
      : '🎵';
    return `
      <div class="card" onclick="router.navigate('/album/${album.id}')">
        <div class="card-image">${imageContent}</div>
        <div class="card-content">
          <div class="card-title">${album.album}</div>
          <div class="card-subtitle">${album.artist}</div>
        </div>
      </div>
    `;
  }).join('');
});

// Album detail
router.addRoute('/album/:id', async (params) => {
  const albums = await fetchAPI('/library/music');
  const album = albums.find(a => a.id === params.id);
  
  if (!album) {
    app.innerHTML = '<div class="container"><p>Album not found</p></div>';
    return;
  }
  
  app.innerHTML = `
    <div class="container">
      <a href="/music" class="back-btn" onclick="route(event, '/music')">← Back to Music</a>
      <div class="detail-view">
        <div class="album-header">
          <div class="album-cover">${album.thumbnail ? `<img src="/thumbnails/${album.thumbnail}" alt="${album.album}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` : '🎵'}</div>
          <div class="album-info">
            <h2>${album.album}</h2>
            <h3>${album.artist}</h3>
            ${album.year ? `<p>Released: ${album.year}</p>` : ''}
            ${album.genre ? `<p>Genre: ${album.genre}</p>` : ''}
          </div>
        </div>
        
        <div class="player-controls">
          <button onclick="playAlbum()" id="playBtn">▶ Play</button>
          <button onclick="pauseAlbum()" id="pauseBtn" disabled>⏸ Pause</button>
          <button onclick="previousTrack()" id="prevBtn" disabled>⏮ Previous</button>
          <button onclick="nextTrack()" id="nextBtn" disabled>⏭ Next</button>
          <span id="nowPlaying" style="margin-left: 20px; color: #888;"></span>
        </div>
        
        <audio id="audioPlayer" style="display: none;"></audio>
        
        <ul class="track-list">
          ${album.tracks.map((track, index) => `
            <li class="track-item" onclick="playTrack(${index})" data-track-index="${index}">
              <div class="track-info">
                <span class="track-number">${track.trackNumber || index + 1}</span>
                <span class="track-title">${track.title}</span>
                <span class="track-duration">${track.duration ? formatDuration(track.duration) : ''}</span>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `;
  
  window.currentAlbum = album;
  window.currentTrackIndex = -1;
});

function playAlbum() {
  playTrack(0);
}

function playTrack(index) {
  const album = window.currentAlbum;
  const track = album.tracks[index];
  const audioPlayer = document.getElementById('audioPlayer');
  
  audioPlayer.src = `/media/music/${track.id}`;
  audioPlayer.play();
  
  window.currentTrackIndex = index;
  
  document.getElementById('playBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('prevBtn').disabled = index === 0;
  document.getElementById('nextBtn').disabled = index === album.tracks.length - 1;
  
  document.getElementById('nowPlaying').textContent = `Now playing: ${track.title}`;
  
  // Highlight current track
  document.querySelectorAll('.track-item').forEach((item, i) => {
    if (i === index) {
      item.style.background = '#667eea';
    } else {
      item.style.background = '#252525';
    }
  });
  
  // Auto-play next track
  audioPlayer.onended = () => {
    if (index < album.tracks.length - 1) {
      playTrack(index + 1);
    } else {
      document.getElementById('playBtn').disabled = false;
      document.getElementById('pauseBtn').disabled = true;
      document.getElementById('nowPlaying').textContent = '';
    }
  };
  
  // Track progress
  audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.currentTime > 0 && audioPlayer.duration > 0) {
      postAPI('/playback', {
        mediaType: 'music',
        mediaId: track.id,
        position: audioPlayer.currentTime,
        duration: audioPlayer.duration
      });
    }
  });
}

function pauseAlbum() {
  const audioPlayer = document.getElementById('audioPlayer');
  audioPlayer.pause();
  document.getElementById('playBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
}

function previousTrack() {
  if (window.currentTrackIndex > 0) {
    playTrack(window.currentTrackIndex - 1);
  }
}

function nextTrack() {
  const album = window.currentAlbum;
  if (window.currentTrackIndex < album.tracks.length - 1) {
    playTrack(window.currentTrackIndex + 1);
  }
}

async function resumePlayback(type, id) {
  if (type === 'movies') {
    router.navigate(`/movie/${id}`);
  } else if (type === 'tv') {
    router.navigate('/tv');
    // Would need to find the exact episode path
  } else if (type === 'music') {
    router.navigate('/music');
  }
}

// Navigation helper
function route(event, path) {
  event.preventDefault();
  router.navigate(path);
}

// Make functions global
window.router = router;
window.route = route;
window.sortMovies = sortMovies;
window.playMovie = playMovie;
window.playEpisode = playEpisode;
window.playAlbum = playAlbum;
window.playTrack = playTrack;
window.pauseAlbum = pauseAlbum;
window.previousTrack = previousTrack;
window.nextTrack = nextTrack;
window.resumePlayback = resumePlayback;

// Start the app
router.navigate(window.location.pathname, false);
