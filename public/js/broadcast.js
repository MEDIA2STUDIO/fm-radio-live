let ws = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let scriptProcessor = null;
let isBroadcasting = false;
let startTime = null;
let timerInterval = null;
let currentSource = 'mic';

// MP3 related
let mp3AudioElement = null;
let mp3SourceNode = null;
let mp3IsPlaying = false;
let isLooping = false;

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
    // Don't redirect on network errors
  }

  mp3AudioElement = document.getElementById('mp3AudioElement');

  // File input handler
  document.getElementById('mp3FileInput').addEventListener('change', handleMp3File);
  mp3AudioElement.addEventListener('timeupdate', updateMp3Progress);
  mp3AudioElement.addEventListener('loadedmetadata', onMp3Loaded);
  mp3AudioElement.addEventListener('ended', onMp3Ended);
  mp3AudioElement.addEventListener('play', () => { mp3IsPlaying = true; });
  mp3AudioElement.addEventListener('pause', () => { mp3IsPlaying = false; });
}

function toggleSource() {
  const selected = document.querySelector('input[name="audioSource"]:checked').value;
  currentSource = selected;

  if (selected === 'mic') {
    document.getElementById('micSection').style.display = 'block';
    document.getElementById('mp3Section').style.display = 'none';
    document.querySelector('.broadcast-header h2').innerHTML = '<i class="fas fa-microphone"></i> Your Broadcast';
  } else {
    document.getElementById('micSection').style.display = 'none';
    document.getElementById('mp3Section').style.display = 'block';
    document.querySelector('.broadcast-header h2').innerHTML = '<i class="fas fa-music"></i> MP3 Player';
  }
}

function handleMp3File(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.includes('audio')) {
    alert('Please select an audio file');
    return;
  }

  const url = URL.createObjectURL(file);
  mp3AudioElement.src = url;
  mp3AudioElement.load();

  document.getElementById('mp3FileName').textContent = file.name;
  document.getElementById('mp3UploadArea').style.display = 'none';
  document.getElementById('mp3Player').style.display = 'block';
  document.getElementById('mp3BroadcastBtn').disabled = false;
  document.getElementById('mp3BroadcastHint').textContent = 'Press to start broadcasting';
}

function onMp3Loaded() {
  const duration = mp3AudioElement.duration;
  document.getElementById('mp3Duration').textContent = formatTime(duration);
  document.getElementById('mp3Seek').max = Math.floor(duration);
}

function updateMp3Progress() {
  if (!mp3AudioElement.duration) return;
  document.getElementById('mp3CurrentTime').textContent = formatTime(mp3AudioElement.currentTime);
  document.getElementById('mp3Seek').value = Math.floor(mp3AudioElement.currentTime);
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toggleMp3Play() {
  if (mp3AudioElement.paused) {
    mp3AudioElement.play();
    document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
  } else {
    mp3AudioElement.pause();
    document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }
}

function seekMp3() {
  const seekTo = parseFloat(document.getElementById('mp3Seek').value);
  mp3AudioElement.currentTime = seekTo;
}

function setMp3Volume() {
  const vol = parseFloat(document.getElementById('mp3Volume').value);
  mp3AudioElement.volume = vol;
}

function setMp3Loop() {
  isLooping = document.getElementById('mp3Loop').checked;
  mp3AudioElement.loop = isLooping;
}

function onMp3Ended() {
  document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  mp3IsPlaying = false;
}

function closeMp3() {
  if (mp3AudioElement) {
    mp3AudioElement.pause();
    mp3AudioElement.src = '';
  }
  document.getElementById('mp3UploadArea').style.display = 'block';
  document.getElementById('mp3Player').style.display = 'none';
  document.getElementById('mp3BroadcastBtn').disabled = true;
  document.getElementById('mp3BroadcastHint').textContent = 'Load an MP3 file to start broadcasting';
}

async function toggleBroadcast() {
  if (isBroadcasting) {
    stopBroadcast();
  } else {
    if (currentSource === 'mp3' && !mp3AudioElement.src) {
      alert('Please upload an MP3 file first');
      return;
    }
    startBroadcast();
  }
}

function cleanupAudioPipeline() {
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor.onaudioprocess = null;
    scriptProcessor = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (mp3SourceNode) {
    mp3SourceNode.disconnect();
    mp3SourceNode = null;
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
}

async function startBroadcast() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const user = await getUser();
    ws = new WebSocket(`${protocol}//${window.location.host}?type=broadcaster&userId=${user.id}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('WebSocket connected');
      isBroadcasting = true;
      updateUI(true);

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      if (currentSource === 'mic') {
        setupMicSource();
      } else {
        setupMp3Source();
      }

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
          const el = currentSource === 'mic'
            ? document.getElementById('listenerCount')
            : document.getElementById('mp3ListenerCount');
          el.textContent = data.count;
        }
      } catch (err) {}
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

  } catch (error) {
    console.error('Error starting broadcast:', error);
    alert('Could not start broadcasting');
  }
}

async function setupMicSource() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  } catch (error) {
    console.error('Could not access microphone:', error);
    stopBroadcast();
    alert('Could not access microphone. Please allow microphone access.');
  }
}

function setupMp3Source() {
  // Resume AudioContext if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  mp3SourceNode = audioContext.createMediaElementSource(mp3AudioElement);
  mp3SourceNode.connect(analyser);
  mp3SourceNode.connect(scriptProcessor);
  scriptProcessor.connect(audioContext.destination);

  // Start playing the MP3 from beginning
  mp3AudioElement.currentTime = 0;
  mp3AudioElement.play();
  document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
}

function stopBroadcast() {
  cleanupAudioPipeline();

  // In MP3 mode, pause but keep file loaded
  if (currentSource === 'mp3') {
    mp3AudioElement.pause();
    document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }

  isBroadcasting = false;
  updateUI(false);

  fetch('/api/broadcast/stop', { method: 'POST' });
}

function updateUI(broadcasting) {
  if (currentSource === 'mic') {
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
  } else {
    const btn = document.getElementById('mp3BroadcastBtn');
    const hint = document.getElementById('mp3BroadcastHint');
    const status = document.getElementById('broadcastStatus');

    if (broadcasting) {
      btn.classList.add('active');
      hint.textContent = 'Press to stop broadcasting';
      status.innerHTML = '<span class="status-dot live"></span><span>Live</span>';
    } else {
      btn.classList.remove('active');
      hint.textContent = 'Load an MP3 file to start broadcasting';
      status.innerHTML = '<span class="status-dot offline"></span><span>Offline</span>';
      document.getElementById('mp3ListenerCount').textContent = '0';
      document.getElementById('mp3BroadcastTime').textContent = '00:00:00';
    }
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (currentSource === 'mic') {
    document.getElementById('broadcastTime').textContent = timeStr;
  } else {
    document.getElementById('mp3BroadcastTime').textContent = timeStr;
  }
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
