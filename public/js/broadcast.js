let ws = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let scriptProcessor = null;
let isBroadcasting = false;
let startTime = null;
let timerInterval = null;

// MP3 related
let mp3AudioElement = null;
let mp3SourceNode = null;
let mp3Gain = null;
let mp3IsPlaying = false;

// Mic gain
let micGain = null;

// Master gain
let masterGain = null;

// Equalizer nodes
let eqLow = null;
let eqMid = null;
let eqHigh = null;

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
  } catch (error) {}

  mp3AudioElement = document.getElementById('mp3AudioElement');

  document.getElementById('mp3FileInput').addEventListener('change', handleMp3File);
  mp3AudioElement.addEventListener('timeupdate', updateMp3Progress);
  mp3AudioElement.addEventListener('loadedmetadata', onMp3Loaded);
  mp3AudioElement.addEventListener('ended', onMp3Ended);
  mp3AudioElement.addEventListener('play', () => { mp3IsPlaying = true; });
  mp3AudioElement.addEventListener('pause', () => { mp3IsPlaying = false; });
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
  mp3AudioElement.loop = document.getElementById('mp3Loop').checked;
}

function onMp3Ended() {
  document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  mp3IsPlaying = false;
}

function setEqBand(band) {
  const val = parseFloat(document.getElementById('eq' + band).value);
  const node = band === 'Low' ? eqLow : band === 'Mid' ? eqMid : eqHigh;
  if (node) {
    node.gain.value = val;
  }
  document.getElementById('eq' + band + 'Val').textContent = (val > 0 ? '+' : '') + val + 'dB';
}

async function toggleBroadcast() {
  if (isBroadcasting) {
    stopBroadcast();
  } else {
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
    try { mp3SourceNode.disconnect(); } catch(e) {}
    mp3SourceNode = null;
  }
  if (micGain) {
    try { micGain.disconnect(); } catch(e) {}
    micGain = null;
  }
  if (mp3Gain) {
    try { mp3Gain.disconnect(); } catch(e) {}
    mp3Gain = null;
  }
  if (eqLow) { try { eqLow.disconnect(); } catch(e) {} eqLow = null; }
  if (eqMid) { try { eqMid.disconnect(); } catch(e) {} eqMid = null; }
  if (eqHigh) { try { eqHigh.disconnect(); } catch(e) {} eqHigh = null; }
  if (masterGain) { try { masterGain.disconnect(); } catch(e) {} masterGain = null; }
  if (analyser) { try { analyser.disconnect(); } catch(e) {} analyser = null; }
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

    ws.onopen = async () => {
      console.log('WebSocket connected');
      isBroadcasting = true;
      updateUI(true);

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Master gain
      masterGain = audioContext.createGain();
      masterGain.gain.value = 1;

      // Analyser
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      // Always try to get mic
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
          }
        });
        const micSource = audioContext.createMediaStreamSource(mediaStream);
        micGain = audioContext.createGain();
        micGain.gain.value = 1;
        micSource.connect(micGain);
        micGain.connect(masterGain);
      } catch (micErr) {
        console.warn('Mic not available, broadcasting MP3 only');
      }

      // If MP3 is loaded, connect it with EQ
      if (mp3AudioElement.src) {
        // Create EQ chain
        eqLow = audioContext.createBiquadFilter();
        eqLow.type = 'lowshelf';
        eqLow.frequency.value = 200;
        eqLow.gain.value = parseFloat(document.getElementById('eqLow').value);

        eqMid = audioContext.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = 1000;
        eqMid.Q.value = 1;
        eqMid.gain.value = parseFloat(document.getElementById('eqMid').value);

        eqHigh = audioContext.createBiquadFilter();
        eqHigh.type = 'highshelf';
        eqHigh.frequency.value = 8000;
        eqHigh.gain.value = parseFloat(document.getElementById('eqHigh').value);

        // MP3 gain control
        mp3Gain = audioContext.createGain();
        mp3Gain.gain.value = mp3AudioElement.volume;

        // Create the media element source AFTER everything else is connected
        // (this must be done before the audio element starts playing)
        mp3SourceNode = audioContext.createMediaElementSource(mp3AudioElement);
        mp3SourceNode.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(mp3Gain);
        mp3Gain.connect(masterGain);

        // Start playing MP3 from beginning
        mp3AudioElement.currentTime = 0;
        mp3AudioElement.play();
        document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
      }

      // Connect master to pipeline
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
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'listener_count') {
          document.getElementById('listenerCount').textContent = data.count;
          document.getElementById('mp3ListenerCount').textContent = data.count;
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

function stopBroadcast() {
  cleanupAudioPipeline();

  if (mp3AudioElement) {
    mp3AudioElement.pause();
    document.getElementById('mp3PlayBtn').innerHTML = '<i class="fas fa-play"></i>';
  }

  isBroadcasting = false;
  updateUI(false);
  fetch('/api/broadcast/stop', { method: 'POST' });
}

function updateUI(broadcasting) {
  const status = document.getElementById('broadcastStatus');
  if (broadcasting) {
    document.getElementById('micButton').classList.add('active');
    document.getElementById('micHint').textContent = 'Press to stop broadcasting';
    document.getElementById('mp3BroadcastBtn').classList.add('active');
    document.getElementById('mp3BroadcastHint').textContent = 'Press to stop broadcasting';
    status.innerHTML = '<span class="status-dot live"></span><span>Live</span>';
  } else {
    document.getElementById('micButton').classList.remove('active');
    document.getElementById('micHint').textContent = 'Press to start broadcasting';
    document.getElementById('mp3BroadcastBtn').classList.remove('active');
    document.getElementById('mp3BroadcastHint').textContent = 'Load an MP3 file to start broadcasting';
    status.innerHTML = '<span class="status-dot offline"></span><span>Offline</span>';
    document.getElementById('listenerCount').textContent = '0';
    document.getElementById('broadcastTime').textContent = '00:00:00';
    document.getElementById('mp3ListenerCount').textContent = '0';
    document.getElementById('mp3BroadcastTime').textContent = '00:00:00';
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('broadcastTime').textContent = timeStr;
  document.getElementById('mp3BroadcastTime').textContent = timeStr;
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
