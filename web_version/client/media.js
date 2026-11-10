// Microphone and camera, ported from desktop/src/electronClient.js.
//
// Browsers only offer getUserMedia on a secure page: HTTPS, or localhost on the
// server itself. Over plain http://192.168.x.x it does not exist, so ScratchJr
// is told there is no microphone or camera and hides those buttons.

export function mediaAvailable() {
  const usable = Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return {microphone: usable && typeof window.MediaRecorder !== 'undefined', camera: usable};
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function stopTracks(stream) {
  if (stream) stream.getTracks().forEach(track => track.stop());
}

export function tryPlay(audioElement) {
  try {
    const playing = audioElement.play();
    if (playing !== undefined) playing.catch(() => {});
  } catch (error) {
    console.warn('Could not play sound', error);
  }
}

export class AudioCapture {
  constructor() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.audioPlaybackElement = null;
  }

  getId(isNewRecording) {
    if (isNewRecording || !this.id) this.id = uuid();
    return this.id;
  }

  startRecord() {
    this.savedBlob = null;
    this.chunks = null;
    if (mediaAvailable().microphone) {
      navigator.mediaDevices.getUserMedia({audio: true}).then(this.beginStartRecord.bind(this), error => console.warn('Microphone unavailable', error));
    }
    return this.getId(true) + '.webm';
  }

  beginStartRecord(stream) {
    this.chunks = null;
    this.currentStream = stream;
    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = event => {
      if (!this.chunks) this.chunks = [];
      this.chunks.push(event.data);
    };
    this.mediaRecorder.start();
  }

  captureRecordingAsBlob() {
    if (this.savedBlob) return this.savedBlob;
    if (!this.chunks || !this.chunks.length) return null;
    this.savedBlob = new Blob(this.chunks, {type: this.chunks[0].type || 'audio/webm'});
    this.chunks = [];
    return this.savedBlob;
  }

  // Resolves once the recorder has handed over its last chunk, which a browser
  // does only after stop().
  stopRecord() {
    this.stopAudioMeter();
    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;
    if (!recorder || recorder.state === 'inactive') {
      stopTracks(this.currentStream);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      recorder.onstop = () => {
        stopTracks(this.currentStream);
        resolve();
      };
      recorder.stop();
    });
  }

  stopPlay() {
    if (this.audioPlaybackElement) {
      this.audioPlaybackElement.pause();
      this.audioPlaybackElement = null;
    }
  }

  startPlay() {
    this.stopRecord().then(() => {
      const blob = this.captureRecordingAsBlob();
      if (!blob) return;
      this.audioPlaybackElement = new Audio(URL.createObjectURL(blob));
      this.audioPlaybackElement.volume = 0.8; // don't oversaturate the speakers
      tryPlay(this.audioPlaybackElement);
    });
  }

  getVolume() {
    if (!this.audioProcessor && this.currentStream && this.mediaRecorder) this.startAudioMeter();
    return this.audioProcessor ? this.audioProcessor.volume : 0;
  }

  // https://github.com/cwilso/volume-meter/blob/master/volume-meter.js
  startAudioMeter() {
    this.mediaStreamSource = this.audioCtx.createMediaStreamSource(this.currentStream);
    const processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
    processor.volume = 0;
    processor.onaudioprocess = event => {
      const buffer = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += Math.abs(buffer[i]);
      // Divided by .5 because the maximum seems to be around .5; enough to show a level.
      processor.volume = Math.sqrt(sum / buffer.length) / 0.5;
    };
    // No effect, since nothing is copied to the output, but works around a Chrome bug.
    processor.connect(this.audioCtx.destination);
    this.mediaStreamSource.connect(processor);
    this.audioProcessor = processor;
  }

  stopAudioMeter() {
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor.onaudioprocess = null;
      this.mediaStreamSource.disconnect();
      this.audioProcessor = null;
      this.mediaStreamSource = null;
    }
  }
}

class VideoCapture {
  constructor(videoElement) {
    this.videoElement = videoElement;
  }

  startRecord(constraints) {
    if (!mediaAvailable().camera) return;
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
      this.currentStream = stream;
      this.videoElement.srcObject = stream;
    }, error => console.warn('Camera unavailable', error));
  }

  stopRecord() {
    stopTracks(this.currentStream);
    this.currentStream = null;
    this.videoElement.pause();
    this.videoElement.srcObject = null;
  }

  // The current frame as a PNG data URL.
  snapshot(cameraRect, isMirrored) {
    if (!this.currentStream) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cameraRect.width;
    canvas.height = cameraRect.height;
    const ctx = canvas.getContext('2d');
    if (isMirrored) {
      ctx.translate(cameraRect.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.videoElement, 0, 0, cameraRect.width, cameraRect.height);
    return canvas.toDataURL('image/png');
  }
}

// The live picture shown inside a shape while the camera is filling it.
export class CameraPickerDialog {
  constructor(data) {
    this.shapeData = data;
    this.isMirrored = true;
  }

  show() {
    if (this.div) return;
    const data = this.shapeData;
    this.div = document.createElement('div');
    this.div.id = 'cameraPickerDiv';
    this.div.style.cssText = 'z-index:90000; position:absolute; top:0; left:0;';

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    // A mirror is easier to get yourself into the frame with.
    if (this.isMirrored) video.style.transform = 'scale(-1, 1)';
    const mask = document.createElement('img');
    mask.src = data.image;
    this.div.append(video, mask);
    document.getElementById('backdrop').appendChild(this.div);

    // The opening in the shape, then the rest of the drawing laid over it.
    layout(video, data.x, data.y, data.width, data.height);
    layout(mask, data.mx, data.my, data.mw, data.mh);

    this.capture = new VideoCapture(video);
    this.capture.startRecord({video: {width: data.width, height: data.height}});
  }

  snapshot() {
    if (!this.capture) return null;
    return this.capture.snapshot({x: 0, y: 0, width: this.shapeData.width, height: this.shapeData.height}, this.isMirrored);
  }

  hide() {
    if (!this.capture) return;
    this.capture.stopRecord();
    this.capture = null;
    this.div.remove();
    this.div = null;
  }
}

function layout(el, x, y, w, h) {
  el.style.position = 'absolute';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  if (w) el.style.width = w + 'px';
  if (h) el.style.height = h + 'px';
}
