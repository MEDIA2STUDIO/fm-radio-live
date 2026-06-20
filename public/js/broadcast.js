/* ========== STATE ========== */
let ws = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let scriptProcessor = null;
let isBroadcasting = false;
let startTime = null;
let timerInterval = null;

// Mic
let micGain = null;

// Master
let masterGain = null;

// EQ nodes
let eqLow = null, eqMid = null, eqHigh = null;

// Playlist
let playlist = [];
let currentTrackIndex = -1;
let playlistLoop = false;
let playlistAudio = null;
let playlistGain = null;
let playlistStream = null;

// AI Announcer
let aiEnabled = false;
let aiSpeaking = false;
let aiTimer = null;
let aiSentenceIndex = 0;

/* ========== INIT ========== */
async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (data.user) {
      document.getElementById('userDisplay').textContent = `Welcome, ${data.user.display_name || data.user.username}`;
    } else { window.location.href = '/login'; }
  } catch (e) {}

  playlistAudio = document.getElementById('playlistAudioElement');

  // Playlist file input
  document.getElementById('playlistFiles').addEventListener('change', handlePlaylistFiles);
  playlistAudio.addEventListener('timeupdate', updatePlaylistProgress);
  playlistAudio.addEventListener('loadedmetadata', onPlaylistLoaded);
  playlistAudio.addEventListener('ended', onPlaylistEnded);
}

/* ========== STUDIO TABS ========== */
function switchStudioTab(tab) {
  document.querySelectorAll('.studio-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.studio-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.studio-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById('studio' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

/* ========== PLAYLIST ========== */
function handlePlaylistFiles(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (!file.type.includes('audio')) return;
    const url = URL.createObjectURL(file);
    playlist.push({ id: Date.now() + Math.random(), name: file.name, src: url, type: 'upload' });
  });
  renderPlaylist();
}

function addUrlToPlaylist() {
  const input = document.getElementById('playlistUrlInput');
  const url = input.value.trim();
  if (!url) return;
  const name = url.split('/').pop().split('?')[0] || 'Stream URL';
  playlist.push({ id: Date.now() + Math.random(), name, src: url, type: 'url' });
  input.value = '';
  renderPlaylist();
}

function removeFromPlaylist(id) {
  playlist = playlist.filter(s => s.id !== id);
  if (currentTrackIndex >= playlist.length) currentTrackIndex = playlist.length - 1;
  renderPlaylist();
}

function movePlaylistItem(id, dir) {
  const idx = playlist.findIndex(s => s.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= playlist.length) return;
  [playlist[idx], playlist[newIdx]] = [playlist[newIdx], playlist[idx]];
  if (currentTrackIndex === idx) currentTrackIndex = newIdx;
  else if (currentTrackIndex === newIdx) currentTrackIndex = idx;
  renderPlaylist();
}

function renderPlaylist() {
  const queue = document.getElementById('playlistQueue');
  document.getElementById('playlistCount').textContent = playlist.length;

  if (playlist.length === 0) {
    queue.innerHTML = '<p class="playlist-empty">No songs in playlist. Upload MP3 files or add a URL.</p>';
    return;
  }

  const hasCurrent = currentTrackIndex >= 0 && currentTrackIndex < playlist.length;

  queue.innerHTML = playlist.map((song, i) => `
    <div class="playlist-item ${i === currentTrackIndex && hasCurrent ? 'playing' : ''}">
      <div class="playlist-item-info">
        <span class="playlist-item-idx">${i + 1}</span>
        <i class="fas fa-music"></i>
        <span class="playlist-item-name">${escapeHtml(song.name)}</span>
        <span class="playlist-item-type">${song.type === 'url' ? 'URL' : 'File'}</span>
      </div>
      <div class="playlist-item-actions">
        <button onclick="playTrack(${i})" class="btn-icon" title="Play"><i class="fas fa-play"></i></button>
        <button onclick="movePlaylistItem(${song.id}, -1)" class="btn-icon" title="Move Up"><i class="fas fa-chevron-up"></i></button>
        <button onclick="movePlaylistItem(${song.id}, 1)" class="btn-icon" title="Move Down"><i class="fas fa-chevron-down"></i></button>
        <button onclick="removeFromPlaylist(${song.id})" class="btn-icon btn-icon-danger" title="Remove"><i class="fas fa-times"></i></button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function playTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  currentTrackIndex = index;
  const song = playlist[index];
  playlistAudio.src = song.src;
  playlistAudio.load();
  playlistAudio.play();
  document.getElementById('playlistCurrent').style.display = 'block';
  document.getElementById('currentTrackName').textContent = song.name;
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
  renderPlaylist();
}

function playNextTrack() {
  if (playlist.length === 0) return;
  if (currentTrackIndex < playlist.length - 1) playTrack(currentTrackIndex + 1);
  else if (playlistLoop) playTrack(0);
  else { stopPlaylist(); }
}

function playPrevTrack() {
  if (playlist.length === 0) return;
  if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
  else if (playlistLoop) playTrack(playlist.length - 1);
}

function togglePlaylistPlay() {
  if (!playlistAudio.src) {
    if (playlist.length > 0) { playTrack(0); }
    return;
  }
  if (playlistAudio.paused) {
    playlistAudio.play();
    document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
  } else {
    playlistAudio.pause();
    document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }
}

function stopPlaylist() {
  playlistAudio.pause();
  playlistAudio.src = '';
  currentTrackIndex = -1;
  document.getElementById('playlistCurrent').style.display = 'none';
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  renderPlaylist();
}

function onPlaylistLoaded() {
  const dur = playlistAudio.duration;
  document.getElementById('playlistDuration').textContent = formatTime(dur);
  document.getElementById('playlistSeek').max = Math.floor(dur);
}

function updatePlaylistProgress() {
  if (!playlistAudio.duration) return;
  document.getElementById('playlistCurrentTime').textContent = formatTime(playlistAudio.currentTime);
  document.getElementById('playlistSeek').value = Math.floor(playlistAudio.currentTime);
}

function seekPlaylist() {
  playlistAudio.currentTime = parseFloat(document.getElementById('playlistSeek').value);
}

function onPlaylistEnded() {
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  playNextTrack();
}

function setPlaylistLoop() {
  playlistLoop = document.getElementById('playlistLoop').checked;
}

/* ========== AI ANNOUNCER ========== */
function toggleAi() {
  aiEnabled = document.getElementById('aiToggle').checked;
  if (aiEnabled) {
    startAi();
  } else {
    stopAi();
  }
}

function startAi() {
  const script = document.getElementById('aiScript').value.trim();
  if (!script) { document.getElementById('aiToggle').checked = false; aiEnabled = false; return; }

  const sentences = script.split(/[.!?।\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) { document.getElementById('aiToggle').checked = false; aiEnabled = false; return; }

  aiSentenceIndex = 0;
  document.getElementById('aiStatusDot').className = 'ai-status-dot active';
  document.getElementById('aiStatusText').textContent = 'AI is speaking...';

  speakNextAiSentence(sentences);
}

function speakNextAiSentence(sentences) {
  if (!aiEnabled || !isBroadcasting) { stopAi(); return; }

  if (aiSentenceIndex >= sentences.length) {
    aiSentenceIndex = 0; // Loop back
    // If no sentences, stop
    if (sentences.length === 0) { stopAi(); return; }
  }

  const sentence = sentences[aiSentenceIndex];
  aiSentenceIndex++;

  aiSpeaking = true;
  document.getElementById('aiStatusText').textContent = `AI: "${sentence.substring(0, 50)}${sentence.length > 50 ? '...' : ''}"`;

  // Fetch TTS audio from server
  const lang = document.getElementById('aiLang').value;
  fetch(`/api/tts?text=${encodeURIComponent(sentence)}&lang=${encodeURIComponent(lang)}`)
    .then(res => {
      if (!res.ok) throw new Error('TTS failed');
      return res.arrayBuffer();
    })
    .then(buffer => {
      if (!audioContext || !isBroadcasting) return;
      audioContext.decodeAudioData(buffer, (audioBuffer) => {
        if (!audioContext || !isBroadcasting) return;
        playAiBuffer(audioBuffer, () => {
          aiSpeaking = false;
          // Schedule next sentence after interval
          const interval = parseInt(document.getElementById('aiInterval').value) * 1000;
          if (aiTimer) clearTimeout(aiTimer);
          if (aiEnabled && isBroadcasting) {
            aiTimer = setTimeout(() => speakNextAiSentence(sentences), interval);
          }
        });
      }, () => {
        aiSpeaking = false;
        if (aiEnabled && isBroadcasting) {
          const interval = parseInt(document.getElementById('aiInterval').value) * 1000;
          aiTimer = setTimeout(() => speakNextAiSentence(sentences), interval);
        }
      });
    })
    .catch(err => {
      console.error('AI TTS error:', err);
      aiSpeaking = false;
      document.getElementById('aiStatusText').textContent = 'AI: TTS error, retrying...';
      if (aiEnabled && isBroadcasting) {
        aiTimer = setTimeout(() => speakNextAiSentence(sentences), 3000);
      }
    });
}

function playAiBuffer(audioBuffer, onEnd) {
  if (!audioContext) return;
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = parseFloat(document.getElementById('aiSpeed').value);
  const aiGain = audioContext.createGain();
  aiGain.gain.value = parseFloat(document.getElementById('aiVolume').value);
  source.connect(aiGain);
  aiGain.connect(masterGain);
  source.start();
  source.onended = () => {
    aiGain.disconnect();
    if (onEnd) onEnd();
  };
}

function stopAi() {
  aiEnabled = false;
  if (document.getElementById('aiToggle')) document.getElementById('aiToggle').checked = false;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  aiSpeaking = false;
  aiSentenceIndex = 0;
  const dot = document.getElementById('aiStatusDot');
  const txt = document.getElementById('aiStatusText');
  if (dot) dot.className = 'ai-status-dot';
  if (txt) txt.textContent = 'AI is idle';
}

/* ========== EQUALIZER ========== */
function setEqBand(band) {
  const val = parseFloat(document.getElementById('eq' + band).value);
  const node = band === 'Low' ? eqLow : band === 'Mid' ? eqMid : eqHigh;
  if (node) node.gain.value = val;
  document.getElementById('eq' + band + 'Val').textContent = (val > 0 ? '+' : '') + val + 'dB';
}

/* ========== BROADCAST ========== */
async function toggleBroadcast() {
  if (isBroadcasting) { stopBroadcast(); }
  else { startBroadcast(); }
}

function cleanupAudioPipeline() {
  if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor.onaudioprocess = null; scriptProcessor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (playlistStream) { try { playlistStream.getTracks().forEach(t => t.stop()); } catch(e) {} playlistStream = null; }
  if (playlistGain) { try { playlistGain.disconnect(); } catch(e) {} playlistGain = null; }
  if (micGain) { try { micGain.disconnect(); } catch(e) {} micGain = null; }
  if (eqLow) { try { eqLow.disconnect(); } catch(e) {} eqLow = null; }
  if (eqMid) { try { eqMid.disconnect(); } catch(e) {} eqMid = null; }
  if (eqHigh) { try { eqHigh.disconnect(); } catch(e) {} eqHigh = null; }
  if (masterGain) { try { masterGain.disconnect(); } catch(e) {} masterGain = null; }
  if (analyser) { try { analyser.disconnect(); } catch(e) {} analyser = null; }
  if (ws) { ws.close(); ws = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
}

async function startBroadcast() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const user = await getUser();
    ws = new WebSocket(`${protocol}//${window.location.host}?type=broadcaster&userId=${user.id}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      console.log('WebSocket connected');
      isBroadcasting = true;
      updateUI(true);

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();

      // Master gain - all sources mix here
      masterGain = audioContext.createGain();
      masterGain.gain.value = 1;

      // Analyser
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      // --- MICROPHONE ---
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
        });
        const micSource = audioContext.createMediaStreamSource(mediaStream);
        micGain = audioContext.createGain();
        micGain.gain.value = 1;
        micSource.connect(micGain);
        micGain.connect(masterGain);
      } catch (micErr) {
        console.warn('Mic not available');
      }

      // --- PLAYLIST (EQ + gain) ---
      if (playlistAudio.src && playlistAudio.src !== window.location.href && !playlistAudio.paused) {
        connectPlaylistToPipeline();
      }

      // Connect master → analyser → scriptProcessor → destination
      masterGain.connect(analyser);
      masterGain.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      // Stream audio
      scriptProcessor.onaudioprocess = (e) => {
        if (!isBroadcasting || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const sampleRate = audioContext.sampleRate;
        const numSamples = inputData.length;
        const buffer = new ArrayBuffer(8 + numSamples * 2);
        const view = new DataView(buffer);
        view.setUint32(0, sampleRate, true);
        view.setUint32(4, numSamples, true);
        for (let i = 0; i < numSamples; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          view.setInt16(8 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        ws.send(buffer);
      };

      startTime = Date.now();
      timerInterval = setInterval(updateTimer, 1000);
      visualize();

      // Start AI if enabled
      if (aiEnabled && document.getElementById('aiToggle').checked) {
        startAi();
      }
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'listener_count') {
          document.getElementById('listenerCount').textContent = data.count;
        }
      } catch (err) {}
    };

    ws.onclose = () => { console.log('WebSocket disconnected'); };

  } catch (error) {
    console.error('Error starting broadcast:', error);
    alert('Could not start broadcasting');
  }
}

function connectPlaylistToPipeline() {
  try {
    if (!playlistAudio.src || !playlistAudio.captureStream) return;

    const stream = playlistAudio.captureStream();
    playlistStream = stream;
    const source = audioContext.createMediaStreamSource(stream);

    // Create EQ chain
    eqLow = audioContext.createBiquadFilter();
    eqLow.type = 'lowshelf'; eqLow.frequency.value = 200;
    eqLow.gain.value = parseFloat(document.getElementById('eqLow').value);

    eqMid = audioContext.createBiquadFilter();
    eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1;
    eqMid.gain.value = parseFloat(document.getElementById('eqMid').value);

    eqHigh = audioContext.createBiquadFilter();
    eqHigh.type = 'highshelf'; eqHigh.frequency.value = 8000;
    eqHigh.gain.value = parseFloat(document.getElementById('eqHigh').value);

    playlistGain = audioContext.createGain();
    playlistGain.gain.value = 1;

    source.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(playlistGain);
    playlistGain.connect(masterGain);
  } catch(e) {
    console.warn('Could not connect playlist to pipeline:', e.message);
  }
}

function stopBroadcast() {
  stopAi();
  cleanupAudioPipeline();
  isBroadcasting = false;
  updateUI(false);
  fetch('/api/broadcast/stop', { method: 'POST' });
}

/* ========== UI ========== */
function updateUI(broadcasting) {
  const status = document.getElementById('broadcastStatus');
  if (broadcasting) {
    document.getElementById('micButton').classList.add('active');
    document.getElementById('micHint').textContent = 'Press to stop broadcasting';
    status.innerHTML = '<span class="status-dot live"></span><span>Live</span>';
  } else {
    document.getElementById('micButton').classList.remove('active');
    document.getElementById('micHint').textContent = 'Press to start broadcasting';
    status.innerHTML = '<span class="status-dot offline"></span><span>Offline</span>';
    document.getElementById('listenerCount').textContent = '0';
    document.getElementById('broadcastTime').textContent = '00:00:00';
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  document.getElementById('broadcastTime').textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function visualize() {
  if (!analyser) return;
  const canvas = document.getElementById('visualizerCanvas');
  const ctx = canvas.getContext('2d');
  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  function draw() {
    if (!isBroadcasting) return;
    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bw = (canvas.width / bufLen) * 2.5;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const bh = (data[i] / 255) * canvas.height;
      const g = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - bh);
      g.addColorStop(0, '#ff6b35'); g.addColorStop(1, '#f7931e');
      ctx.fillStyle = g;
      ctx.fillRect(x, canvas.height - bh, bw, bh);
      x += bw + 1;
    }
  }
  draw();
}

async function getUser() {
  const res = await fetch('/api/auth/me');
  return (await res.json()).user;
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function logout() {
  if (isBroadcasting) stopBroadcast();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

init();
