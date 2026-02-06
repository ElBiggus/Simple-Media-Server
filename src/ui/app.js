const { ipcRenderer } = require('electron');

let config = null;

// Initialize
async function init() {
  config = await ipcRenderer.invoke('get-config');
  document.getElementById('port').value = config.port;
  
  loadFolders();
  loadLibrary();
  updateServerStatus();
  
  // Set up event listeners
  setupEventListeners();
}

function setupEventListeners() {
  // Server controls
  document.getElementById('startServer').addEventListener('click', startServer);
  document.getElementById('stopServer').addEventListener('click', stopServer);
  
  // Add folder buttons
  document.getElementById('addMovieFolder').addEventListener('click', () => addFolder('movies'));
  document.getElementById('addTVFolder').addEventListener('click', () => addFolder('tv'));
  document.getElementById('addMusicFolder').addEventListener('click', () => addFolder('music'));
  
  // Scan buttons
  document.getElementById('scanMovies').addEventListener('click', () => scanMedia('movies'));
  document.getElementById('scanTV').addEventListener('click', () => scanMedia('tv'));
  document.getElementById('scanMusic').addEventListener('click', () => scanMedia('music'));
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const tabGroup = this.parentElement;
      const tabName = this.dataset.tab;
      
      // Update active tab
      tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      
      // Update active content
      const contentContainer = tabGroup.nextElementSibling;
      while (contentContainer && !contentContainer.classList.contains('section')) {
        if (contentContainer.classList.contains('tab-content')) {
          contentContainer.classList.remove('active');
        }
        contentContainer = contentContainer.nextElementSibling;
      }
      
      // Show correct content
      const allContents = document.querySelectorAll('.tab-content');
      allContents.forEach(content => {
        if (content.id === tabName || content.id === `${tabName}-folders`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });
}

async function startServer() {
  const port = parseInt(document.getElementById('port').value);
  const result = await ipcRenderer.invoke('start-server', port);
  
  if (result.success) {
    updateServerStatus();
  } else {
    alert(`Failed to start server: ${result.error}`);
  }
}

async function stopServer() {
  const result = await ipcRenderer.invoke('stop-server');
  if (result.success) {
    updateServerStatus();
  }
}

async function updateServerStatus() {
  const status = await ipcRenderer.invoke('get-server-status');
  const statusEl = document.getElementById('serverStatus');
  const webLink = document.getElementById('webLink');
  const webLinkAnchor = document.getElementById('webLinkAnchor');
  
  if (status.running) {
    statusEl.textContent = `Running on port ${status.port}`;
    statusEl.className = 'status running';
    webLinkAnchor.href = `http://localhost:${status.port}`;
    webLink.style.display = 'block';
    document.getElementById('startServer').disabled = true;
    document.getElementById('stopServer').disabled = false;
  } else {
    statusEl.textContent = 'Stopped';
    statusEl.className = 'status stopped';
    webLink.style.display = 'none';
    document.getElementById('startServer').disabled = false;
    document.getElementById('stopServer').disabled = true;
  }
}

async function addFolder(type) {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) {
    await ipcRenderer.invoke('add-media-folder', type, folder);
    config = await ipcRenderer.invoke('get-config');
    loadFolders();
  }
}

async function removeFolder(type, folder) {
  await ipcRenderer.invoke('remove-media-folder', type, folder);
  config = await ipcRenderer.invoke('get-config');
  loadFolders();
}

function loadFolders() {
  ['movies', 'tv', 'music'].forEach(type => {
    const listId = type === 'movies' ? 'movieFolderList' : type === 'tv' ? 'tvFolderList' : 'musicFolderList';
    const list = document.getElementById(listId);
    list.innerHTML = '';
    
    const folders = config.mediaFolders[type] || [];
    folders.forEach(folder => {
      const li = document.createElement('li');
      li.className = 'folder-item';
      li.innerHTML = `
        <span>${folder}</span>
        <button class="danger" onclick="removeFolder('${type}', '${folder.replace(/\\/g, '\\\\')}')">Remove</button>
      `;
      list.appendChild(li);
    });
  });
}

async function scanMedia(type) {
  const button = event.target;
  button.disabled = true;
  button.textContent = 'Scanning...';
  
  // Get the checkbox state for thumbnails
  let createThumbnails = false;
  if (type === 'movies') {
    createThumbnails = document.getElementById('createMovieThumbnails')?.checked || false;
  } else if (type === 'tv') {
    createThumbnails = document.getElementById('createTVThumbnails')?.checked || false;
  } else if (type === 'music') {
    createThumbnails = document.getElementById('createMusicThumbnails')?.checked || false;
  }
  
  const result = await ipcRenderer.invoke('scan-media', type, createThumbnails);
  
  button.disabled = false;
  button.textContent = `Scan ${type === 'tv' ? 'TV Shows' : type.charAt(0).toUpperCase() + type.slice(1)}`;
  
  if (result.success) {
    loadLibrary();
  } else {
    alert(`Failed to scan ${type}: ${result.error}`);
  }
}

async function loadLibrary() {
  await loadMovies();
  await loadTV();
  await loadMusic();
}

async function loadMovies() {
  const movies = await ipcRenderer.invoke('get-media-library', 'movies');
  const container = document.getElementById('moviesLibrary');
  container.innerHTML = '';
  
  if (movies.length === 0) {
    container.innerHTML = '<p style="color: #888;">No movies found. Add folders and scan to get started.</p>';
    return;
  }
  
  movies.forEach(movie => {
    const div = document.createElement('div');
    div.className = 'media-item';
    div.innerHTML = `
      <h4>${movie.title}${movie.year ? ` (${movie.year})` : ''}</h4>
      <p>${movie.originalFileName}</p>
      <input type="text" value="${movie.title}" id="movie-${movie.id}">
      <button onclick="updateMovie('${movie.id}')">Update Title</button>
    `;
    container.appendChild(div);
  });
}

async function loadTV() {
  const shows = await ipcRenderer.invoke('get-media-library', 'tv');
  const container = document.getElementById('tvLibrary');
  container.innerHTML = '';
  
  if (shows.length === 0) {
    container.innerHTML = '<p style="color: #888;">No TV shows found. Add folders and scan to get started.</p>';
    return;
  }
  
  shows.forEach(show => {
    const episodeCount = show.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
    const div = document.createElement('div');
    div.className = 'media-item';
    div.innerHTML = `
      <h4>${show.name}</h4>
      <p>${show.seasons.length} seasons, ${episodeCount} episodes</p>
    `;
    container.appendChild(div);
  });
}

async function loadMusic() {
  const albums = await ipcRenderer.invoke('get-media-library', 'music');
  const container = document.getElementById('musicLibrary');
  container.innerHTML = '';
  
  if (albums.length === 0) {
    container.innerHTML = '<p style="color: #888;">No music found. Add folders and scan to get started.</p>';
    return;
  }
  
  albums.forEach(album => {
    const div = document.createElement('div');
    div.className = 'media-item';
    div.innerHTML = `
      <h4>${album.album}</h4>
      <p>${album.artist}</p>
      <p>${album.tracks.length} tracks${album.year ? ` • ${album.year}` : ''}</p>
    `;
    container.appendChild(div);
  });
}

async function updateMovie(id) {
  const newTitle = document.getElementById(`movie-${id}`).value;
  await ipcRenderer.invoke('update-media-item', 'movies', id, { title: newTitle });
  loadMovies();
}

// Make functions global for onclick handlers
window.removeFolder = removeFolder;
window.updateMovie = updateMovie;

// Initialize on load
init();
