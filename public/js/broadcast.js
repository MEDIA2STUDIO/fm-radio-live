let ws = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let scriptProcessor = null;
let isBroadcasting = false;
let startTime = null;
let timerInterval = null;

async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    if (data.user) {
      document.getElementById('userDisplay').textContent = `Welcome, ${data.user.display_name || data.user.username}`;
    } else {
      window.location.href = '/login';
    }
  } catch (error) {
    // Don't redirect on network errors, just show the page
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
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const user = await getUser();
    ws = new WebSocket(`${protocol}//${window.location.host}?type=broadcaster&userId=${user.id}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('WebSocket connected');
      isBroadcasting = true;
      updateUI(true);

      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      source.connect(scriptProcessor);
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

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

  } catch (error) {
    console.error('Error starting broadcast:', error);
    alert('Could not access microphone. Please allow microphone access.');
  }
}

function stopBroadcast() {
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor.onaudioprocess = null;
    scriptProcessor = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  isBroadcasting = false;
  updateUI(false);

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

init();