/* =========================
   AxyMusic – MAIN PAGE LOGIC
   Persistence: localStorage (primary) + cookie (mirror)
   ========================= */

// --- playlist state ---
let playlist = [];
let currentIndex = 0;
let isShuffle = true;

// Manual priority queue
let prioritizedQueue = [];

// ===== Cross-tab channel for live updates =====
let bc = null;
try { bc = new BroadcastChannel('axymusic'); } catch(e) { bc = null; }

// ===== Storage keys (versioned to avoid old corrupted entries) =====
const STORAGE_KEYS = {
  IDS:  'axymusic_v2_liked_ids',
  META: 'axymusic_v2_liked_meta'
};

// ===== Cookie helpers (mirror only) =====
function setCookie(name, value, days = 3650) {
  try {
    // NOTE: cookies do not work on file:// — that's ok; localStorage is our source of truth
    const d = new Date();
    d.setTime(d.getTime() + days*24*60*60*1000);
    const encoded = encodeURIComponent(value);
    document.cookie = `${name}=${encoded};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  } catch(e) {}
}
function getCookie(name) {
  try {
    const target = name + "=";
    const ca = document.cookie.split(';');
    for (let c of ca) {
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(target) === 0) return decodeURIComponent(c.substring(target.length));
    }
  } catch(e) {}
  return null;
}

// ===== Likes (IDs) + Metadata cache =====
function loadLiked() {
  // 1) Try localStorage (source of truth)
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.IDS);
    if (raw) return new Set(JSON.parse(raw));
  } catch(e) {}
  // 2) Fallback to cookie (if running on http/https)
  try {
    const raw = getCookie(STORAGE_KEYS.IDS);
    if (raw) return new Set(JSON.parse(raw));
  } catch(e) {}
  return new Set();
}
function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.META);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    }
  } catch(e) {}
  return {};
}
let liked = loadLiked();
let likedMeta = loadMeta();

function persistAll() {
  try { localStorage.setItem(STORAGE_KEYS.IDS, JSON.stringify(Array.from(liked))); } catch(e) {}
  try { localStorage.setItem(STORAGE_KEYS.META, JSON.stringify(likedMeta)); } catch(e) {}
  // Mirror into cookie (best effort; ignored on file://)
  setCookie(STORAGE_KEYS.IDS, JSON.stringify(Array.from(liked)));
  // Update UI badge
  updateLikedCount();
  // Notify other tabs/pages
  try { bc?.postMessage({ type: 'likes-updated' }); } catch(e) {}
}
window.addEventListener('beforeunload', persistAll);

function isLiked(id){ return liked.has(id); }

function getMetaById(song_id) {
  // Prefer DOM (fresh) then cache
  const dom = {
    name: document.getElementById(`${song_id}-n`)?.textContent || '',
    album: document.getElementById(`${song_id}-a`)?.textContent || '',
    image: document.getElementById(`${song_id}-i`)?.src || '',
    url:  getUrlById(song_id) || ''
  };
  const cached = likedMeta[song_id] || {};
  return {
    id: song_id,
    name: dom.name || cached.name || '',
    album: dom.album || cached.album || '',
    image: dom.image || cached.image || '',
    url: dom.url || cached.url || ''
  };
}

function getUrlById(id) {
  const t = playlist.find(x => x.id === id);
  return t ? t.url : (likedMeta[id]?.url || '');
}

function toggleLike(id) {
  if (!id) return;
  if (liked.has(id)) {
    liked.delete(id);
    delete likedMeta[id];
  } else {
    liked.add(id);
    // capture freshest metadata at the moment of liking
    const m = getMetaById(id);
    likedMeta[id] = { id, name: m.name, album: m.album, image: m.image, url: m.url };
  }
  // IMMEDIATE persist
  persistAll();

  // Update floating bar heart
  const barLike = document.getElementById('bar-like');
  const currentId = window.__currentSongId;
  if (barLike && id === currentId) {
    barLike.classList.toggle('liked', isLiked(id));
    barLike.textContent = isLiked(id) ? '♥' : '♡';
  }
  // Update list heart
  const btn = document.querySelector(`[data-like="${id}"]`);
  if (btn) {
    btn.classList.toggle('liked', isLiked(id));
    btn.textContent = isLiked(id) ? '♥' : '♡';
  }
}

function addToQueue(id) {
  if (!id) return;
  if (!prioritizedQueue.includes(id)) prioritizedQueue.push(id);
  const q = document.getElementById('bar-queue');
  if (q) { q.disabled = true; setTimeout(() => q.disabled = false, 350); }
}

function updateFloatingBar(song_id) {
  const m = getMetaById(song_id);
  const barTitle = document.getElementById('bar-title');
  const barArtist = document.getElementById('bar-artist');
  const barCover  = document.getElementById('bar-cover');
  const barLike   = document.getElementById('bar-like');

  if (barTitle)  barTitle.textContent = m.name || 'AxyMusic';
  if (barArtist) barArtist.textContent = m.album || '';
  if (barCover && m.image) barCover.src = m.image;

  if (barLike) {
    barLike.classList.toggle('liked', isLiked(song_id));
    barLike.textContent = isLiked(song_id) ? '♥' : '♡';
  }
}

/** Play & update UI */
function PlayAudio(audio_url, song_id) {
  const audio  = document.getElementById('player');
  const source = document.getElementById('audioSource');
  source.src = audio_url;

  const meta   = getMetaById(song_id);
  document.getElementById('player-name').textContent  = meta.name || '';
  document.getElementById('player-album').textContent = meta.album || '';
  document.getElementById('player-image').src         = meta.image || '';

  window.__currentSongId = song_id;
  updateFloatingBar(song_id);

  // Keep cache fresh for liked song
  if (isLiked(song_id)) {
    likedMeta[song_id] = { id: song_id, name: meta.name, album: meta.album, image: meta.image, url: audio_url };
    persistAll();
  }

  audio.load();
  audio.play();
}

function PauseAudio() {
  document.getElementById('player').pause();
}

/** Render results (lines) + build playlist */
async function renderResults(query, page = 1) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodedQuery}&limit=40&page=${page}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const songs = json?.data?.results || [];

    const resultsContainer = document.getElementById('saavn-results');
    if (page === 1) {
      resultsContainer.innerHTML = '';
      playlist = []; // reset playlist ONLY
    }

    if (songs.length === 0) {
      if (page === 1) resultsContainer.innerHTML = '<p>No songs found.</p>';
      return;
    }

    songs.forEach((track) => {
      const id    = track.id;
      const name  = track.name;
      const album = track.album?.name || '';
      const image = track.image?.[1]?.link || track.image?.[0]?.link || '';
      const url   = track.downloadUrl?.[3]?.link || track.downloadUrl?.[1]?.link || '';

      playlist.push({ id, url });

      const row = document.createElement('div');
      row.className = 'song-container';
      row.innerHTML = `
        <img id="${id}-i" src="${image}" alt="">
        <div class="song-info">
          <p id="${id}-n">${name}</p>
          <p id="${id}-a">${album}</p>
        </div>
        <div class="song-actions">
          <button onclick="PlayAudio('${url}','${id}'); currentIndex=${playlist.length - 1};">▶</button>
          <button data-like="${id}" onclick="toggleLike('${id}')" class="${isLiked(id)?'liked':''}">${isLiked(id) ? '♥' : '♡'}</button>
          <button onclick="addToQueue('${id}')" title="Add to queue">Play Next</button>
        </div>
      `;
      resultsContainer.appendChild(row);

      // If already liked but missing URL, fill it from this result
      if (isLiked(id) && (!likedMeta[id] || !likedMeta[id].url)) {
        likedMeta[id] = { id, name, album, image, url };
        persistAll();
      }
    });
  } catch (err) {
    document.getElementById('saavn-results').innerHTML = `<p>Error: ${err.message}</p>`;
  }
}

/** next/prev/shuffle with prioritized queue checked first */
function setupControls() {
  document.getElementById('next-button').onclick = () => {
    if (playlist.length === 0) return;

    if (prioritizedQueue.length > 0) {
      const nextId = prioritizedQueue.shift();
      const ix = playlist.findIndex(t => t.id === nextId);
      if (ix !== -1) {
        currentIndex = ix;
        const { url, id } = playlist[currentIndex];
        PlayAudio(url, id);
        return;
      }
    }
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

  document.getElementById('shuffle-button').onclick = () => {
    isShuffle = !isShuffle;
    const btn = document.getElementById('shuffle-button');
    btn.style.opacity = isShuffle ? '1' : '0.5';
    btn.textContent = isShuffle ? '🔀' : '🔀✖️';
  };
}

/** Search form */
function setupSearchForm() {
  const form = document.getElementById('search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('saavn-search-box').value.trim();
    if (query) renderResults(query);
  });
  renderResults('Lil Peep'); // default
}

/** Auto-next on ended */
document.addEventListener('DOMContentLoaded', () => {
  const audio = document.getElementById('player');
  audio.addEventListener('ended', () => {
    if (!audio.loop) document.getElementById('next-button').click();
  });
});

/** Pagination */
function setupLoadMore() {
  let currentPage = 1;
  document.getElementById('load-more').addEventListener('click', () => {
    const query = document.getElementById('saavn-search-box').value.trim() || 'Lil Peep';
    currentPage += 1;
    renderResults(query, currentPage);
  });
}

/** Floating bar like/queue buttons */
function setupBarActions() {
  const barLike  = document.getElementById('bar-like');
  const barQueue = document.getElementById('bar-queue');
  if (barLike)  barLike.addEventListener('click', () => toggleLike(window.__currentSongId));
  if (barQueue) barQueue.addEventListener('click', () => addToQueue(window.__currentSongId));
}

/** Badge count */
function updateLikedCount() {
  const badge = document.getElementById('liked-count');
  if (badge) badge.textContent = String(liked.size);
}

/* Media Session + wake lock + cast (unchanged) */
(function() {
  const audio = document.getElementById('player');

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => document.getElementById('prev-button').click());
      navigator.mediaSession.setActionHandler('nexttrack',     () => document.getElementById('next-button').click());
      navigator.mediaSession.setActionHandler('play',  () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      try { navigator.mediaSession.setActionHandler('seekforward', null); navigator.mediaSession.setActionHandler('seekbackward', null); } catch(e) {}

      const refreshMeta = () => {
        try {
          const title = document.getElementById('player-name')?.textContent || 'AxyMusic';
          const artist = document.getElementById('player-album')?.textContent || '';
          const art = document.getElementById('player-image')?.src || '';
          navigator.mediaSession.metadata = new MediaMetadata({
            title, artist, album: artist,
            artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : []
          });
        } catch(e) {}
      };
      const refreshPos = () => {
        try {
          if (isFinite(audio.duration) && !isNaN(audio.duration)) {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              position: audio.currentTime,
              playbackRate: audio.playbackRate
            });
          }
          navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
        } catch(e) {}
      };
      ['play','pause','loadedmetadata','timeupdate','durationchange','ratechange']
        .forEach(ev => audio.addEventListener(ev, () => { refreshMeta(); refreshPos(); }));
    } catch(e) {}
  }

  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && navigator.wakeLock.request) wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
  }
  function releaseWakeLock() { try { wakeLock?.release?.(); wakeLock = null; } catch(e) {} }

  audio.addEventListener('play', requestWakeLock);
  audio.addEventListener('pause', releaseWakeLock);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !audio.paused) requestWakeLock(); });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audio.paused && audio.currentTime > 0) audio.play().catch(()=>{});
  });

  window.__onGCastApiAvailable = function(isAvailable) {
    if (!isAvailable) return;
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    const loadToCast = () => {
      const session = context.getCurrentSession();
      if (!session) return;
      const src = document.getElementById('audioSource')?.src || '';
      if (!src) return;
      const type = src.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4';
      const mediaInfo = new chrome.cast.media.MediaInfo(src, type);
      const title = document.getElementById('player-name')?.textContent || 'AxyMusic';
      const artist = document.getElementById('player-album')?.textContent || '';
      const art = document.getElementById('player-image')?.src || '';
      mediaInfo.metadata = new chrome.cast.media.MusicTrackMediaMetadata();
      mediaInfo.metadata.title = title;
      mediaInfo.metadata.artist = artist;
      if (art) mediaInfo.metadata.images = [{ url: art }];
      const request = new chrome.cast.media.LoadRequest(mediaInfo);
      try { context.getCurrentSession()?.loadMedia(request); } catch(e){}
    };
    audio.addEventListener('play', loadToCast);
    audio.addEventListener('loadedmetadata', loadToCast);
  };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Ensure in-memory matches localStorage at startup
  liked = loadLiked();
  likedMeta = loadMeta();
  updateLikedCount();

  setupControls();
  setupSearchForm();
  setupLoadMore();
  setupBarActions();

  // Cross-tab sync via storage
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.IDS || e.key === STORAGE_KEYS.META) {
      try { liked = new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.IDS) || '[]')); } catch(_) {}
      try { likedMeta = JSON.parse(localStorage.getItem(STORAGE_KEYS.META) || '{}'); } catch(_) { likedMeta = {}; }
      updateLikedCount();
    }
  });
});
