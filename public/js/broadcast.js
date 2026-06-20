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
let micMuted = false;

// Master
let masterGain = null;

// EQ nodes
let eqLow = null, eqMid = null, eqHigh = null;

// Playlist - dual audio elements for seamless transitions
let playlist = [];
let currentTrackIndex = -1;
let playlistLoop = false;
let playlistGain = null;
let playlistStream = null;

let audioEls = [null, null];
let activeAudioIdx = 0;
let nextPreloadedIdx = -1;

// AI Announcer
let aiAutoMode = false;
let aiSpeaking = false;
let aiTimer = null;
let aiSentenceIndex = 0;
let aiSentences = [];

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

  audioEls[0] = document.getElementById('playlistAudio1');
  audioEls[1] = document.getElementById('playlistAudio2');

  // Setup audio ended listeners
  audioEls[0].addEventListener('ended', onAudioEnded);
  audioEls[1].addEventListener('ended', onAudioEnded);

  // Listen for play events to auto-reconnect pipeline
  audioEls[0].addEventListener('play', onAudioPlay);
  audioEls[1].addEventListener('play', onAudioPlay);

  document.getElementById('playlistFiles').addEventListener('change', handlePlaylistFiles);
}

function getActiveAudio() { return audioEls[activeAudioIdx]; }
function getInactiveAudio() { return audioEls[1 - activeAudioIdx]; }

function onAudioPlay() {
  // When audio starts playing during broadcast, reconnect pipeline
  if (isBroadcasting && !micMuted) {
    setTimeout(reconnectPlaylistPipeline, 100);
  }
}

function onAudioEnded() {
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  if (currentTrackIndex < playlist.length - 1) {
    playTrack(currentTrackIndex + 1);
  } else if (playlistLoop && playlist.length > 0) {
    playTrack(0);
  } else {
    stopPlaylist();
  }
}

/* ========== STUDIO TABS ========== */
function switchStudioTab(tab) {
  document.querySelectorAll('.studio-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.studio-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.studio-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById('studio' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

/* ========== MIC MUTE ========== */
function toggleMicMute() {
  micMuted = !micMuted;
  const btn = document.getElementById('micMuteBtn');
  const icon = document.getElementById('micMuteIcon');
  const text = document.getElementById('micMuteText');
  if (micMuted) {
    if (micGain) micGain.gain.value = 0;
    btn.classList.add('muted');
    icon.className = 'fas fa-microphone-slash';
    text.textContent = 'Unmute';
  } else {
    if (micGain) micGain.gain.value = 1;
    btn.classList.remove('muted');
    icon.className = 'fas fa-microphone';
    text.textContent = 'Mute';
  }
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
  const wasCurrent = currentTrackIndex >= 0 && currentTrackIndex < playlist.length && playlist[currentTrackIndex].id === id;
  if (wasCurrent) stopPlaylist();
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

function preloadNextTrack() {
  const nextIdx = currentTrackIndex + 1;
  if (nextIdx < playlist.length) {
    nextPreloadedIdx = nextIdx;
    const inactive = getInactiveAudio();
    inactive.src = playlist[nextIdx].src;
    inactive.load();
  } else if (playlistLoop && playlist.length > 0) {
    nextPreloadedIdx = 0;
    const inactive = getInactiveAudio();
    inactive.src = playlist[0].src;
    inactive.load();
  } else {
    nextPreloadedIdx = -1;
  }
}

function playTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  currentTrackIndex = index;
  const song = playlist[index];
  const active = getActiveAudio();

  active.src = song.src;
  active.load();
  active.play();

  document.getElementById('playlistCurrent').style.display = 'block';
  document.getElementById('currentTrackName').textContent = song.name;
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';

  // Update seek max once loaded
  active.onloadedmetadata = () => {
    if (getActiveAudio() === active) {
      document.getElementById('playlistDuration').textContent = formatTime(active.duration);
      document.getElementById('playlistSeek').max = Math.floor(active.duration);
    }
  };

  // Time update
  active.ontimeupdate = () => {
    if (getActiveAudio() === active) {
      if (!active.duration) return;
      document.getElementById('playlistCurrentTime').textContent = formatTime(active.currentTime);
      document.getElementById('playlistSeek').value = Math.floor(active.currentTime);
    }
  };

  // Pre-load next track in background
  preloadNextTrack();
  renderPlaylist();
}

function playNextTrack() {
  if (playlist.length === 0) return;
  // If next is preloaded on inactive element, use it for instant switch
  if (nextPreloadedIdx >= 0 && nextPreloadedIdx < playlist.length && nextPreloadedIdx !== currentTrackIndex) {
    instantSwitchTrack(nextPreloadedIdx);
  } else if (currentTrackIndex < playlist.length - 1) {
    playTrack(currentTrackIndex + 1);
  } else if (playlistLoop) {
    playTrack(0);
  } else {
    stopPlaylist();
  }
}

function instantSwitchTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  const oldIdx = activeAudioIdx;
  const newIdx = 1 - activeAudioIdx;

  // The inactive element already has the next track pre-loaded
  const oldEl = audioEls[oldIdx];
  const newEl = audioEls[newIdx];

  // Stop old
  oldEl.pause();

  // Switch to new
  activeAudioIdx = newIdx;
  currentTrackIndex = index;
  newEl.play();
  newEl.volume = parseFloat(document.getElementById('playlistVolume').value);

  const song = playlist[index];
  document.getElementById('currentTrackName').textContent = song.name;
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';

  // Update seek
  newEl.onloadedmetadata = () => {
    if (getActiveAudio() === newEl) {
      document.getElementById('playlistDuration').textContent = formatTime(newEl.duration);
      document.getElementById('playlistSeek').max = Math.floor(newEl.duration);
    }
  };

  newEl.ontimeupdate = () => {
    if (getActiveAudio() === newEl) {
      if (!newEl.duration) return;
      document.getElementById('playlistCurrentTime').textContent = formatTime(newEl.currentTime);
      document.getElementById('playlistSeek').value = Math.floor(newEl.currentTime);
    }
  };

  // Reconnect pipeline if broadcasting
  if (isBroadcasting) {
    reconnectPlaylistPipeline();
  }

  // Pre-load next
  preloadNextTrack();
  renderPlaylist();
}

function playPrevTrack() {
  if (playlist.length === 0) return;
  if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
  else if (playlistLoop) playTrack(playlist.length - 1);
}

function togglePlaylistPlay() {
  const active = getActiveAudio();
  if (!active.src || active.src === window.location.href) {
    if (playlist.length > 0) { playTrack(0); }
    return;
  }
  if (active.paused) {
    active.play();
    document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
  } else {
    active.pause();
    document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }
}

function stopPlaylist() {
  audioEls.forEach(el => { el.pause(); el.src = ''; el.onloadedmetadata = null; el.ontimeupdate = null; });
  currentTrackIndex = -1;
  nextPreloadedIdx = -1;
  activeAudioIdx = 0;
  document.getElementById('playlistCurrent').style.display = 'none';
  document.getElementById('playlistPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  renderPlaylist();
}

function seekPlaylist() {
  const active = getActiveAudio();
  active.currentTime = parseFloat(document.getElementById('playlistSeek').value);
}

function setPlaylistLoop() {
  playlistLoop = document.getElementById('playlistLoop').checked;
}

function setPlaylistVolume() {
  const vol = parseFloat(document.getElementById('playlistVolume').value);
  audioEls.forEach(el => { if (el) el.volume = vol; });
  if (playlistGain) playlistGain.gain.value = vol;
}

/* ========== AI ANNOUNCER ========== */
function speakNow() {
  if (!isBroadcasting) { alert('Start broadcasting first'); return; }
  const script = document.getElementById('aiScript').value.trim();
  if (!script) { alert('Enter a script first'); return; }

  aiSentences = script.split(/[.!?।\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (aiSentences.length === 0) { alert('Script has no valid sentences'); return; }

  aiSentenceIndex = 0;
  document.getElementById('aiStatusDot').className = 'ai-status-dot active';
  document.getElementById('aiStatusText').textContent = 'AI speaking...';
  document.getElementById('aiSpeakBtn').disabled = true;
  speakNextAiSentence();
}

function speakNextAiSentence() {
  if (!isBroadcasting) { stopAi(); return; }
  if (aiSentenceIndex >= aiSentences.length) {
    if (aiAutoMode) { aiSentenceIndex = 0; }
    else { stopAi(); return; }
  }
  const sentence = aiSentences[aiSentenceIndex];
  aiSentenceIndex++;
  aiSpeaking = true;
  document.getElementById('aiStatusText').textContent =
    `AI: "${sentence.substring(0, 45)}${sentence.length > 45 ? '...' : ''}"`;

  const lang = document.getElementById('aiLang').value;

  fetch(`/api/tts?text=${encodeURIComponent(sentence)}&lang=${encodeURIComponent(lang)}`)
    .then(res => { if (!res.ok) throw new Error('TTS proxy failed'); return res.arrayBuffer(); })
    .then(buffer => {
      if (!audioContext || !isBroadcasting) return;
      audioContext.decodeAudioData(buffer, audioBuffer => {
        if (!audioContext || !isBroadcasting) return;
        playAiBuffer(audioBuffer, onAiSentenceEnd);
      }, () => onAiSentenceEnd());
    })
    .catch(() => {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = lang === 'ta' ? 'ta-IN' : lang;
      utterance.rate = parseFloat(document.getElementById('aiSpeed').value);
      utterance.volume = parseFloat(document.getElementById('aiVolume').value);
      utterance.onend = onAiSentenceEnd;
      utterance.onerror = onAiSentenceEnd;
      speechSynthesis.speak(utterance);
    });
}

function onAiSentenceEnd() {
  aiSpeaking = false;
  document.getElementById('aiSpeakBtn').disabled = false;
  if (aiAutoMode && isBroadcasting) {
    const interval = parseInt(document.getElementById('aiInterval').value) * 1000;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(() => { if (aiAutoMode && isBroadcasting) speakNextAiSentence(); }, interval);
  } else if (aiSentenceIndex >= aiSentences.length) {
    stopAi();
  }
}

function toggleAiAuto() {
  aiAutoMode = document.getElementById('aiAutoToggle').checked;
  document.getElementById('aiExtraOptions').style.display = aiAutoMode ? 'flex' : 'none';
  if (aiAutoMode && isBroadcasting && aiSentences.length === 0 && document.getElementById('aiScript').value.trim()) {
    speakNow();
  }
}

function stopAi() {
  aiAutoMode = false;
  if (document.getElementById('aiAutoToggle')) document.getElementById('aiAutoToggle').checked = false;
  document.getElementById('aiExtraOptions').style.display = 'none';
  speechSynthesis.cancel();
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  aiSpeaking = false;
  aiSentenceIndex = 0;
  aiSentences = [];
  document.getElementById('aiSpeakBtn').disabled = false;
  const dot = document.getElementById('aiStatusDot');
  const txt = document.getElementById('aiStatusText');
  if (dot) dot.className = 'ai-status-dot';
  if (txt) txt.textContent = 'Press Speak Now to announce';
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
  source.onended = () => { aiGain.disconnect(); if (onEnd) onEnd(); };
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
  if (isBroadcasting) stopBroadcast();
  else startBroadcast();
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

      masterGain = audioContext.createGain();
      masterGain.gain.value = 1;

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      // --- MICROPHONE (always try) ---
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
        });
        const micSource = audioContext.createMediaStreamSource(mediaStream);
        micGain = audioContext.createGain();
        micGain.gain.value = micMuted ? 0 : 1;
        micSource.connect(micGain);
        micGain.connect(masterGain);
      } catch (micErr) {
        console.warn('Mic not available');
        document.getElementById('micMuteBtn').disabled = true;
      }

      // --- PLAYLIST (connect whichever audio element is playing) ---
      connectPlaylistToPipeline();

      // Connect master → analyser → scriptProcessor → destination
      masterGain.connect(analyser);
      masterGain.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

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

function reconnectPlaylistPipeline() {
  if (!isBroadcasting || !audioContext) return;
  // Disconnect old playlist stream
  if (playlistStream) { try { playlistStream.getTracks().forEach(t => t.stop()); } catch(e) {} playlistStream = null; }
  if (playlistGain) { try { playlistGain.disconnect(); } catch(e) {} playlistGain = null; }
  if (eqLow) { try { eqLow.disconnect(); } catch(e) {} eqLow = null; }
  if (eqMid) { try { eqMid.disconnect(); } catch(e) {} eqMid = null; }
  if (eqHigh) { try { eqHigh.disconnect(); } catch(e) {} eqHigh = null; }
  connectPlaylistToPipeline();
}

function connectPlaylistToPipeline() {
  try {
    const active = getActiveAudio();
    if (!active.src || !active.captureStream || active.paused || active.src === window.location.href) return;

    const stream = active.captureStream();
    playlistStream = stream;
    const source = audioContext.createMediaStreamSource(stream);

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
    playlistGain.gain.value = parseFloat(document.getElementById('playlistVolume').value);

    source.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(playlistGain);
    playlistGain.connect(masterGain);

    console.log('Playlist connected to pipeline');
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
