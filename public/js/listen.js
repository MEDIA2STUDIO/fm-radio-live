let audioContext = null;
let audioQueue = [];
let isPlaying = false;
let nextPlayTime = 0;
let currentBroadcasterId = null;

async function init() {
  await loadBroadcasters();

  const params = new URLSearchParams(window.location.search);
  const broadcasterId = params.get('broadcaster');
  if (broadcasterId) {
    listenToBroadcaster(broadcasterId);
  }

  setInterval(loadBroadcasters, 5000);
}

async function loadBroadcasters() {
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    const container = document.getElementById('broadcastersList');
    const noBroadcasts = document.getElementById('noBroadcasts');

    if (data.broadcasters.length === 0) {
      container.style.display = 'none';
      noBroadcasts.style.display = 'block';
      return;
    }

    container.style.display = 'grid';
    noBroadcasts.style.display = 'none';

    container.innerHTML = data.broadcasters.map(b => `
      <div class="broadcaster-card" id="card-${b.id}">
        <div class="broadcaster-avatar">
          ${b.display_name ? b.display_name.charAt(0).toUpperCase() : 'R'}
        </div>
        <div class="broadcaster-info">
          <h3>${b.display_name || b.username}</h3>
          <p><i class="fas fa-map-marker-alt"></i> ${b.location || 'Unknown location'}</p>
          <p><i class="fas fa-headphones"></i> ${b.listeners} listening now</p>
        </div>
        <button onclick="listenToBroadcaster('${b.id}')" class="btn btn-primary">
          <i class="fas fa-play"></i> Listen
        </button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading broadcasters:', error);
  }
}

async function listenToBroadcaster(broadcasterId) {
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    const broadcaster = data.broadcasters.find(b => b.id == broadcasterId);

    if (!broadcaster) {
      alert('Broadcaster not found or offline');
      return;
    }

    currentBroadcasterId = broadcasterId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}?type=listener&broadcasterId=${broadcasterId}`);
    ws.binaryType = 'arraybuffer';

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    nextPlayTime = 0;
    audioQueue = [];
    isPlaying = true;

    const playerHtml = `
      <div class="player-container" id="player-${broadcasterId}">
        <div class="player-header">
          <div class="player-broadcaster">
            <div class="broadcaster-avatar small">
              ${broadcaster.display_name ? broadcaster.display_name.charAt(0).toUpperCase() : 'R'}
            </div>
            <div>
              <h3>${broadcaster.display_name || broadcaster.username}</h3>
              <p><i class="fas fa-map-marker-alt"></i> ${broadcaster.location || 'Unknown location'}</p>
            </div>
          </div>
          <button onclick="stopListening('${broadcasterId}')" class="btn btn-secondary btn-sm">
            <i class="fas fa-times"></i> Stop
          </button>
        </div>
        <div class="player-visualizer">
          <canvas id="playerCanvas-${broadcasterId}"></canvas>
        </div>
        <div class="player-controls">
          <div class="now-playing">
            <i class="fas fa-broadcast-tower pulse-dot"></i>
            <span>Now Playing</span>
          </div>
        </div>
      </div>
    `;

    const container = document.getElementById('broadcastersList');
    const existingPlayer = document.querySelector('.player-container');
    if (existingPlayer) existingPlayer.remove();
    container.insertAdjacentHTML('beforebegin', playerHtml);

    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;

      try {
        const view = new DataView(e.data);
        const sampleRate = view.getUint32(0, true);
        const numSamples = view.getUint32(4, true);

        if (numSamples <= 0 || numSamples > 65536) return;

        const float32 = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const int16 = view.getInt16(8 + i * 2, true);
          float32[i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF);
        }

        const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate || audioContext.sampleRate);
        audioBuffer.getChannelData(0).set(float32);

        scheduleBuffer(audioBuffer);
      } catch (err) {
        console.error('Audio decode error:', err);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from broadcaster');
      isPlaying = false;
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    visualizePlayer(broadcasterId);

  } catch (error) {
    console.error('Error listening to broadcaster:', error);
    alert('Could not connect to broadcaster');
  }
}

function scheduleBuffer(audioBuffer) {
  const now = audioContext.currentTime;

  // If nextPlayTime is too far ahead (gap from transition), reset it
  if (nextPlayTime > now + 0.3) {
    nextPlayTime = now + 0.05;
  }

  if (nextPlayTime < now) {
    nextPlayTime = now + 0.05;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start(nextPlayTime);

  nextPlayTime += audioBuffer.duration;
}

function stopListening(broadcasterId) {
  const player = document.getElementById(`player-${broadcasterId}`);
  if (player) player.remove();

  isPlaying = false;
  currentBroadcasterId = null;
  audioQueue = [];
  nextPlayTime = 0;

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

function visualizePlayer(broadcasterId) {
  const canvas = document.getElementById(`playerCanvas-${broadcasterId}`);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const bars = 50;

  function draw() {
    if (!isPlaying) return;
    requestAnimationFrame(draw);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = canvas.width / bars - 2;

    for (let i = 0; i < bars; i++) {
      const barHeight = Math.random() * canvas.height * 0.8;

      const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
      gradient.addColorStop(0, '#ff6b35');
      gradient.addColorStop(1, '#f7931e');

      ctx.fillStyle = gradient;
      ctx.fillRect(i * (barWidth + 2), canvas.height - barHeight, barWidth, barHeight);
    }
  }

  draw();
}

init();