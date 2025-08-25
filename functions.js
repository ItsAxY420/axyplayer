let playlist = [];
let currentIndex = 0;
let isShuffle = true;

/**
 * Core function to play audio and update player UI.
 */
function PlayAudio(audio_url, song_id) {
  const audio = document.getElementById('player');
  const source = document.getElementById('audioSource');
  source.src = audio_url;

  const name = document.getElementById(`${song_id}-n`).textContent;
  const album = document.getElementById(`${song_id}-a`).textContent;
  const image = document.getElementById(`${song_id}-i`).src;

  document.getElementById('player-name').textContent = name;
  document.getElementById('player-album').textContent = album;
  document.getElementById('player-image').src = image;

  audio.load();
  audio.play();
}

/**
 * Pause current audio.
 */
function PauseAudio() {
  document.getElementById('player').pause();
}

/**
 * Render search results and build playlist array.
 */
async function renderResults(query, page = 1) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodedQuery}&limit=40&page=${page}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const songs = json.data.results;

    if (!songs || songs.length === 0) {
      document.getElementById('saavn-results').innerHTML = '<p>No songs found.</p>';
      return;
    }

    // Clear results container
    const resultsContainer = document.getElementById('saavn-results');
    resultsContainer.innerHTML = '';

    // Reset playlist
    playlist = [];

    songs.forEach((track, index) => {
      const id = track.id;
      const name = track.name;
      const album = track.album.name;
      const image = track.image[1].link;
      const url = track.downloadUrl[3].link; // 320kbps

      // Save to playlist array
      playlist.push({ id, url });

      // Build DOM
      const container = document.createElement('div');
      container.className = 'song-container';
      container.innerHTML = `
        <img id="${id}-i" src="${image}" />
        <div class="song-info">
          <p id="${id}-n">${name}</p>
          <p id="${id}-a">${album}</p>
        </div>
        <div class="song-actions">
          <button onclick="PlayAudio('${url}', '${id}'); currentIndex = ${index};">▶</button>
        </div>
      `;
      resultsContainer.appendChild(container);
    });
  } catch (err) {
    document.getElementById('saavn-results').innerHTML = `<p>Error: ${err.message}</p>`;
  }
}

/**
 * Hook up navigation controls like next/prev/shuffle/pause
 */
function setupControls() {
  document.getElementById('next-button').onclick = () => {
    if (playlist.length === 0) return;
    currentIndex = isShuffle
      ? Math.floor(Math.random() * playlist.length)
      : (currentIndex + 1) % playlist.length;
    const { url, id } = playlist[currentIndex];
    PlayAudio(url, id);
  };

  document.getElementById('prev-button').onclick = () => {
    if (playlist.length === 0) return;
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    const { url, id } = playlist[currentIndex];
    PlayAudio(url, id);
  };

  // document.getElementById('pause-button').onclick = PauseAudio;

  document.getElementById('shuffle-button').onclick = () => {
    isShuffle = !isShuffle;
    const btn = document.getElementById('shuffle-button');
    btn.style.opacity = isShuffle ? '1' : '0.5';
    btn.textContent = isShuffle ? '🔀' : '🔀✖️';
  };
}


/**
 * Handle song search form
 */
function setupSearchForm() {
  const form = document.getElementById('search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('saavn-search-box').value.trim();
    if (query) renderResults(query);
  });

  // Optional: auto-load default artist
  renderResults('Lil Peep');
}

// Auto-play next track when current ends
document.getElementById('player').addEventListener('ended', () => {
  if (!document.getElementById('player').loop) {
    document.getElementById('next-button').click(); // use existing control
  }
});

/**
 * Load More Button — pagination
 */
function setupLoadMore() {
  let currentPage = 1;
  document.getElementById('load-more').addEventListener('click', () => {
    const query = document.getElementById('saavn-search-box').value.trim();
    if (!query) return;
    currentPage += 1;
    renderResults(query, currentPage);
  });
}


// Initialize everything once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setupControls();
  setupSearchForm();
  setupLoadMore();
});
