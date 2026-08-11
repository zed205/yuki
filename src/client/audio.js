const AudioRecorder = {
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
  stream: null,

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      return false;
    }
  },

  // Continuous recording with voice-activity detection. Calls onSilence(hadVoice)
  // after speech is detected and the signal then stays quiet for
  // silenceDurationMs (or after maxDurationMs total). Call AudioRecorder.stop()
  // to retrieve the audio. hadVoice is true if any voiced audio was detected.
  async startContinuous(onSilence, silenceDurationMs = 1200, maxDurationMs = 30000) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };
      this.mediaRecorder.start();
      this.isRecording = true;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(this.stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const levelData = new Uint8Array(analyser.fftSize);
      const startedAt = Date.now();
      let lastVoiced = startedAt;
      let hasVoiced = false;
      let noiseFloor = 0.005;
      let stopped = false;
      let timer = null;

      const finish = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        try { source.disconnect(); } catch {}
        try { audioCtx.close(); } catch {}
        if (onSilence) onSilence(hasVoiced);
      };

      const pollLevel = () => {
        if (stopped) return;
        const now = Date.now();
        if (now - startedAt > maxDurationMs) {
          finish();
          return;
        }
        analyser.getByteTimeDomainData(levelData);
        let sum = 0;
        for (let i = 0; i < levelData.length; i++) {
          const v = (levelData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / levelData.length);

        // Adaptive noise floor: track down fast, decay up very slowly.
        if (rms < noiseFloor) {
          noiseFloor = rms;
        } else {
          noiseFloor = Math.max(0.002, noiseFloor * 0.9999);
        }
        const threshold = Math.max(0.01, noiseFloor * 2.5);

        if (rms > threshold) {
          hasVoiced = true;
          lastVoiced = now;
        } else if (hasVoiced && now - lastVoiced > silenceDurationMs) {
          finish();
          return;
        }
      };

      timer = setInterval(pollLevel, 100);
      return true;
    } catch (err) {
      console.error('Failed to start continuous recording:', err);
      return false;
    }
  },

  async stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      const promise = new Promise((res) => {
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.audioChunks, { type: 'audio/wav' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result?.toString().split(',')[1] || '';
            res(base64);
          };
          reader.readAsDataURL(blob);
        };
      });

      this.mediaRecorder.stop();
      this.isRecording = false;

      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }

      promise.then(resolve);
    });
  },

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  },
};

const AudioPlayer = {
  audioContext: null,
  currentSource: null,

  // Create/resume the AudioContext inside a user gesture so later
  // playback is allowed by the autoplay policy.
  ensureUnlocked() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  },

  async playBase64(base64Data, mimeType = 'audio/wav') {
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const buffer = await this.audioContext.decodeAudioData(bytes.buffer);

      if (this.currentSource) {
        this.currentSource.stop();
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start();
      this.currentSource = source;

      return new Promise((resolve) => {
        source.onended = () => {
          if (this.currentSource === source) {
            this.currentSource = null;
          }
          resolve(true);
        };
      });
    } catch (err) {
      console.error('Failed to play audio:', err);
      return false;
    }
  },

  stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
      .replace(/\$(.*?)\$/g, '$1')
      .replace(/(\*{1,2}|_{1,2}|~~)(.*?)\1/g, '$2')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/^-{3,}\s*$/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  async playSynthesized(text) {
    try {
      const cleanText = this.stripMarkdown(text);
      const response = await fetch('/api/audio/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
      });

      if (!response.ok) throw new Error('TTS failed');

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const chunks = [];
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        chunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
      }
      const base64 = btoa(chunks.join(''));
      return this.playBase64(base64);
    } catch (err) {
      console.error('Failed to synthesize audio:', err);
      return false;
    }
  },

  get isPlaying() {
    return !!this.currentSource;
  },

  stop() {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
  },
};
