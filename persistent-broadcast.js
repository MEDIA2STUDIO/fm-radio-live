const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const path = require('path');
const WebSocket = require('ws');

const persistentBroadcasts = new Map();

class PersistentBroadcast {
  constructor(userId, playlist, wss) {
    this.userId = userId;
    this.playlist = playlist;
    this.currentTrackIndex = 0;
    this.wss = wss;
    this.ffmpegProc = null;
    this.listeners = new Set();
    this.active = true;
    this.trackBuffer = Buffer.alloc(0);
    this.sampleRate = 44100;
    this.chunkSamples = 4096;
  }

  addListener(ws) {
    this.listeners.add(ws);
  }

  removeListener(ws) {
    this.listeners.delete(ws);
  }

  start() {
    if (this.playlist.length === 0) return;
    console.log(`Persistent broadcast started for user ${this.userId}, ${this.playlist.length} tracks`);
    persistentBroadcasts.set(this.userId, this);
    this.playCurrentTrack();
  }

  playCurrentTrack() {
    if (!this.active) return;

    if (this.currentTrackIndex >= this.playlist.length) {
      this.currentTrackIndex = 0; // loop back
    }

    const song = this.playlist[this.currentTrackIndex];
    const inputPath = this.resolveInputPath(song);

    if (!inputPath) {
      this.currentTrackIndex++;
      setImmediate(() => this.playCurrentTrack());
      return;
    }

    console.log(`Persistent: playing track ${this.currentTrackIndex + 1}/${this.playlist.length}: ${song.name}`);

    this.ffmpegProc = spawn(ffmpeg, [
      '-i', inputPath,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(this.sampleRate),
      '-ac', '1',
      'pipe:1'
    ]);

    this.trackBuffer = Buffer.alloc(0);

    this.ffmpegProc.stdout.on('data', (chunk) => {
      if (!this.active) return;
      this.trackBuffer = Buffer.concat([this.trackBuffer, chunk]);

      const sampleSize = 2;
      const chunkBytes = this.chunkSamples * sampleSize;

      while (this.trackBuffer.length >= chunkBytes) {
        const frame = this.trackBuffer.slice(0, chunkBytes);
        this.trackBuffer = this.trackBuffer.slice(chunkBytes);
        this.broadcastPcm(frame, this.chunkSamples);
      }
    });

    this.ffmpegProc.on('close', () => {
      if (!this.active) return;
      // Flush remaining buffer
      if (this.trackBuffer.length > 0) {
        const remSamples = Math.floor(this.trackBuffer.length / 2);
        if (remSamples > 0) {
          this.broadcastPcm(this.trackBuffer, remSamples);
        }
      }
      this.trackBuffer = Buffer.alloc(0);
      this.currentTrackIndex++;
      if (this.active) {
        setImmediate(() => this.playCurrentTrack());
      }
    });

    this.ffmpegProc.on('error', (err) => {
      console.error(`ffmpeg error for user ${this.userId}:`, err.message);
      this.currentTrackIndex++;
      if (this.active) setImmediate(() => this.playCurrentTrack());
    });
  }

  broadcastPcm(pcmData, numSamples) {
    if (this.listeners.size === 0) return;

    const buffer = new ArrayBuffer(8 + numSamples * 2);
    const view = new DataView(buffer);
    view.setUint32(0, this.sampleRate, true);
    view.setUint32(4, numSamples, true);

    const src = new Int16Array(pcmData.buffer, pcmData.byteOffset, numSamples);
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(8 + i * 2, src[i], true);
    }

    this.listeners.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }
    });
  }

  resolveInputPath(song) {
    if (!song || !song.src) return null;
    if (song.src.startsWith('/uploads/') || song.src.startsWith('uploads/')) {
      return path.join(__dirname, 'public', song.src.replace(/^\//, ''));
    }
    if (song.src.startsWith('http://') || song.src.startsWith('https://')) {
      return song.src;
    }
    if (song.src.startsWith('/')) {
      return path.join(__dirname, 'public', song.src.replace(/^\//, ''));
    }
    return null;
  }

  stop() {
    this.active = false;
    if (this.ffmpegProc) {
      try { this.ffmpegProc.kill(); } catch (e) {}
      this.ffmpegProc = null;
    }
    this.trackBuffer = null;
    persistentBroadcasts.delete(this.userId);
    console.log(`Persistent broadcast stopped for user ${this.userId}`);
  }

  nextTrack() {
    if (this.ffmpegProc) {
      try { this.ffmpegProc.kill(); } catch (e) {}
      this.ffmpegProc = null;
    }
    this.trackBuffer = Buffer.alloc(0);
    this.currentTrackIndex++;
    if (this.active) setImmediate(() => this.playCurrentTrack());
  }

  prevTrack() {
    if (this.ffmpegProc) {
      try { this.ffmpegProc.kill(); } catch (e) {}
      this.ffmpegProc = null;
    }
    this.trackBuffer = Buffer.alloc(0);
    if (this.currentTrackIndex > 0) this.currentTrackIndex--;
    if (this.active) setImmediate(() => this.playCurrentTrack());
  }

  getStatus() {
    return {
      active: this.active,
      currentTrackIndex: this.currentTrackIndex,
      totalTracks: this.playlist.length,
      currentTrack: this.playlist[this.currentTrackIndex] || null,
      listenerCount: this.listeners.size
    };
  }
}

module.exports = { PersistentBroadcast, persistentBroadcasts };
