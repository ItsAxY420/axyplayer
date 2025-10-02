/* =========================
   AxyMusic – LIKED PAGE LOGIC
   Shows only liked songs using persisted localStorage data.
   ========================= */

const STORAGE_KEYS = {
  IDS:  'axymusic_v2_liked_ids',
  META: 'axymusic_v2_liked_meta'
};

// BroadcastChannel for live updates
let bc = null;
try { bc = new BroadcastChannel('axymusic'); } catch(e) { bc = null; }

// Load state (localStorage = source of truth)
let liked = new Set();
let likedMeta = {};
function loadState() {
  try { liked = new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.IDS) || '[]')); } catch(e) { liked = new Set(); }
  try { likedMeta = JSON.parse(localStorage.getItem(STORAGE_KEYS.META) || '{}') || {}; } catch(e) { likedMeta = {}; }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEYS.IDS, JSON.stringify(Array.from(liked))); } catch(e) {}
  try { localStorage.setItem(STORAGE_KEYS.META, JSON.stringify(likedMeta)); } catch(e) {}
  // mirror to cookie (optional)
  try { document.cookie = `${STORAGE_KEYS.IDS}=${encodeURIComponent(JSON.stringify(Array.from(liked)))};path=/;SameSite=Lax`; } catch(e){}
  updateLikedCount();
  try { bc?.postMessage({ type: 'likes-updated' }); } catch(e){}
}
window.addEventListener('beforeunload', saveState);

function isLiked(id){ return liked.has(id); }

function updateLikedCount() {
  const badge = document.getElementById('liked-count');
  if (badge) badge.textContent = String(liked.size);
}

// Liked-only playlist state
let playlist = []; // [{id,url}]
let currentIndex = 0;
let isShuffle = true;
let prioritizedQueue = [];
let currentFilter = "";

// Build DOM row
function buildRow(m) {
  const id    = m.id;
  const name  = m.name || id;
  const album = m.album || '';
  const image = m.image || '';
  const url   = m.url || '';

  const row = document.createElement('div');
  row.className = 'song-container';
  row.innerHTML = `
    <img id="${id}-i" src="${image}" alt="">
    <div class="song-info">
      <p id="${id}-n">${name}</p>
      <p id="${id}-a">${album}</p>
    </div>
    <div class="song-actions">
      ${url ? `<button onclick="PlayAudio('${url}','${id}'); currentIndex=${playlist.findIndex(t=>t.id===id)};">▶</button>` : `<button disabled>▶</button>`}
      <button data-like="${id}" onclick="toggleLike('${id}')" class="${isLiked(id)?'liked':''}">${isLiked(id) ? '♥' : '♡'}</button>
      <button onclick="addToQueue('${id}')" title="Add to queue">➕</button>
    </div>
  `;
  return row;
}

function renderLiked(filter = "") {
  loadState();
  updateLikedCount();

  const wrap = document.getElementById('saavn-results');
  wrap.innerHTML = '';

  const ids = Array.from(liked);
  let rows = ids.map(id => likedMeta[id] ? likedMeta[id] : { id, name: id, album: '', image: '', url: '' });

  const f = (filter || "").toLowerCase();
  if (f) {
    rows = rows.filter(m =>
      (m.name || '').toLowerCase().includes(f) ||
      (m.album || '').toLowerCase().includes(f)
    );
  }

  playlist = rows.map(m => ({ id: m.id, url: m.url || '' }));

  if (rows.length === 0) {
    wrap.innerHTML = `<p style="text-align:center;opacity:.8">${liked.size ? 'No matches in your likes.' : 'No liked songs yet.'}</p>`;
    return;
  }
  rows.forEach(m => wrap.appendChild(buildRow(m)));
}

function toggleLike(id){
  if (liked.has(id)) { liked.delete(id); delete likedMeta[id]; }
  else { liked.add(id); /* meta usually filled on main page; if needed, keep what we have */ }
  saveState();         // IMMEDIATE persist
  renderLiked(currentFilter);
}

function addToQueue(id) {
  if (!id) return;
  if (!prioritizedQueue.includes(id)) prioritizedQueue.push(id);
  const q = document.getElementById('bar-queue');
  if (q) { q.disabled = true; setTimeout(() => q.disabled = false, 300); }
}

function getMetaById(id){
  const m = likedMeta[id] || {};
  return {
    id,
    name: document.getElementById(`${id}-n`)?.textContent || m.name || '',
    album: document.getElementById(`${id}-a`)?.textContent || m.album || '',
    image: document.getElementById(`${id}-i`)?.src || m.image || '',
    url: m.url || ''
  };
}

function updateFloatingBar(song_id) {
  const m = getMetaById(song_id);
  const barTitle = document.getElementById('bar-title');
  const barArtist = document.getElementById('bar-artist');
  const barCover  = document.getElementById('bar-cover');
  const barLike   = document.getElementById('bar-like');
  if (barTitle)  barTitle.textContent = m.name || 'AxyMusic';
  if (barArtist) barArtist.textContent = m.album || '';
  if (barCover)  barCover.src = m.image || '';
  if (barLike) {
    barLike.classList.toggle('liked', isLiked(song_id));
    barLike.textContent = isLiked(song_id) ? '♥' : '♡';
  }
}

function PlayAudio(audio_url, song_id) {
  const audio  = document.getElementById('player');
  const source = document.getElementById('audioSource');
  source.src = audio_url;

  const m = getMetaById(song_id);
  document.getElementById('player-name').textContent  = m.name || '';
  document.getElementById('player-album').textContent = m.album || '';
  document.getElementById('player-image').src         = m.image || '';

  window.__currentSongId = song_id;
  updateFloatingBar(song_id);

  // Keep cache fresh
  if (isLiked(song_id)) {
    likedMeta[song_id] = { id: song_id, name: m.name, album: m.album, image: m.image, url: audio_url };
    saveState();
  }

  audio.load();
  audio.play();
}

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

    if (isShuffle) currentIndex = Math.floor(Math.random() * playlist.length);
    else currentIndex = (currentIndex + 1) % playlist.length;

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

  const audio = document.getElementById('player');
  audio.addEventListener('ended', () => {
    if (!audio.loop) document.getElementById('next-button').click();
  });
}

function setupFloatingBar() {
  const audio = document.getElementById('player');
  const playBtn = document.getElementById('float-play');
  const prevBtn = document.getElementById('float-prev');
  const nextBtn = document.getElementById('float-next');
  const seek    = document.getElementById('bar-seek');
  const sleepTimer = document.getElementById('sleep-timer');
  const airplayBtn = document.getElementById('airplay-button');
  const castBtn    = document.getElementById('cast-button');

  let sleepTimeout = null;
  const updatePlayButton = () => { playBtn.textContent = audio.paused ? '▶️' : '⏸'; playBtn.setAttribute('aria-pressed', audio.paused ? 'false' : 'true'); };

  playBtn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); updatePlayButton(); });
  prevBtn.addEventListener('click', () => document.getElementById('prev-button')?.click());
  nextBtn.addEventListener('click', () => document.getElementById('next-button')?.click());
  audio.addEventListener('play', updatePlayButton);
  audio.addEventListener('pause', updatePlayButton);
  updatePlayButton();

  audio.addEventListener('timeupdate', () => {
    if (isFinite(audio.duration)) seek.value = (audio.currentTime / audio.duration) * 100 || 0;
  });
  seek.addEventListener('input', () => {
    if (isFinite(audio.duration)) audio.currentTime = (seek.value / 100) * audio.duration;
  });

  sleepTimer.addEventListener('change', () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    const s = parseInt(sleepTimer.value, 10);
    if (s) sleepTimeout = setTimeout(() => { audio.pause(); sleepTimer.value=''; updatePlayButton(); }, s*1000);
  });

  if (window.WebKitPlaybackTargetAvailabilityEvent || audio.webkitShowPlaybackTargetPicker) {
    airplayBtn.style.display = 'inline-block';
    airplayBtn.addEventListener('click', () => audio.webkitShowPlaybackTargetPicker?.());
  }

  window.__onGCastApiAvailable = function(isAvailable) {
    if (!isAvailable) return;
    castBtn.style.display = 'inline-block';
  };

  const barLike  = document.getElementById('bar-like');
  const barQueue = document.getElementById('bar-queue');
  if (barLike)  barLike.addEventListener('click', () => toggleLike(window.__currentSongId));
  if (barQueue) barQueue.addEventListener('click', () => addToQueue(window.__currentSongId));
}

function setupFilter() {
  const form = document.getElementById('search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    currentFilter = document.getElementById('saavn-search-box').value.trim();
    renderLiked(currentFilter);
  });
}

// Live updates from main page
if (bc) bc.onmessage = (ev) => { if (ev?.data?.type === 'likes-updated') renderLiked(currentFilter); };
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEYS.IDS || e.key === STORAGE_KEYS.META) renderLiked(currentFilter);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  updateLikedCount();
  setupControls();
  setupFloatingBar();
  setupFilter();
  renderLiked("");

  // Persist again on unload (extra safety)
  window.addEventListener('beforeunload', saveState);
});
