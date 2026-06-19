let ws = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let isBroadcasting = false;
let startTime = null;
let timerInterval = null;

// Get user info
async function init() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.user) {
      document.getElementById('userDisplay').textContent = `Welcome, ${data.user.display_name || data.user.username}`;
    }
  } catch (error) {
    window.location.href = '/login';
  }
}

async function toggleBroadcast() {
  if (isBroadcasting) {
    stopBroadcast();
  } else {
    startBroadcast();
  }
}

async function startBroadcast() {
  try {
    // Get microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Create audio context for visualization
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    analyser.fftSize = 256;

    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const user = await getUser();
    ws = new WebSocket(`${protocol}//${window.location.host}?type=broadcaster&userId=${user.id}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      isBroadcasting = true;
      updateUI(true);

      // Start streaming audio
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      mediaRecorder.start(100); // Send data every 100ms

      // Start timer
      startTime = Date.now();
      timerInterval = setInterval(updateTimer, 1000);

      // Start visualization
      visualize();
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'listener_count') {
        document.getElementById('listenerCount').textContent = data.count;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

  } catch (error) {
    console.error('Error starting broadcast:', error);
    alert('Could not access microphone. Please allow microphone access.');
  }
}

function stopBroadcast() {
  // Stop media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  // Close WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }

  // Stop timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Stop audio context
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  isBroadcasting = false;
  updateUI(false);

  // Notify server
  fetch('/api/broadcast/stop', { method: 'POST' });
}

function updateUI(broadcasting) {
  const micButton = document.getElementById('micButton');
  const micHint = document.getElementById('micHint');
  const status = document.getElementById('broadcastStatus');

  if (broadcasting) {
    micButton.classList.add('active');
    micHint.textContent = 'Press to stop broadcasting';
    status.innerHTML = '<span class="status-dot live"></span><span>Live</span>';
  } else {
    micButton.classList.remove('active');
    micHint.textContent = 'Press to start broadcasting';
    status.innerHTML = '<span class="status-dot offline"></span><span>Offline</span>';
    document.getElementById('listenerCount').textContent = '0';
    document.getElementById('broadcastTime').textContent = '00:00:00';
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  document.getElementById('broadcastTime').textContent =
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function visualize() {
  if (!analyser) return;

  const canvas = document.getElementById('visualizerCanvas');
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    if (!isBroadcasting) return;

    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;

      const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
      gradient.addColorStop(0, '#ff6b35');
      gradient.addColorStop(1, '#f7931e');

      ctx.fillStyle = gradient;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  }

  draw();
}

async function getUser() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  return data.user;
}

async function logout() {
  if (isBroadcasting) {
    stopBroadcast();
  }
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// Initialize
init();