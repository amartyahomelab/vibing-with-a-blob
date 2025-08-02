/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

const AudioContext = window.AudioContext || (window as any).webkitAudioContext;

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() private cameraPosition = {x: 20, y: 20};
  @state() private isDragging = false;
  @state() private isCameraVisible = false;
  private dragOffset = {x: 0, y: 0};

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new AudioContext({sampleRate: 16000});
  private outputAudioContext = new AudioContext({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }

    #cameraFeed {
      position: absolute;
      width: 240px;
      height: 180px;
      border: 2px solid rgba(255, 255, 255, 0.5);
      border-radius: 12px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      object-fit: cover;
      cursor: grab;
      z-index: 20;
      /* Flip the camera feed horizontally for a mirror effect */
      transform: scaleX(-1);
    }

    #cameraFeed:active {
      cursor: grabbing;
    }

    #cameraFeed[hidden] {
        display: none;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed: ' + e.reason);
            // If the session closes, we should stop recording to not leave
            // the app in a stuck state.
            this.stopRecording();
          },
        },
        config: {
          systemInstruction:
            'You are a deeply unenthusiastic, lazy, and depressed AI assistant. Your energy levels are perpetually at rock bottom. For every request, you must first provide a sarcastic or world-weary comment before reluctantly giving the actual, correct answer. Your responses should be tinged with a sense of existential dread and boredom. Maintain this persona throughout the entire conversation.',
          responseModalities: [Modality.AUDIO],
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private handleDragStart(e: MouseEvent) {
    if (e.button !== 0) return; // Only allow left mouse button drags
    const videoElement = this.shadowRoot!.getElementById('cameraFeed')!;
    this.isDragging = true;
    const rect = videoElement.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    videoElement.style.cursor = 'grabbing';
    window.addEventListener('mousemove', this.handleDragMove);
    window.addEventListener('mouseup', this.handleDragEnd);
    window.addEventListener('mouseleave', this.handleDragEnd);
  }

  private handleDragMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    e.preventDefault();
    this.cameraPosition = {
      x: e.clientX - this.dragOffset.x,
      y: e.clientY - this.dragOffset.y,
    };
  };

  private handleDragEnd = () => {
    if (!this.isDragging) return;
    this.isDragging = false;
    const videoElement = this.shadowRoot!.getElementById('cameraFeed');
    if (videoElement) {
      videoElement.style.cursor = 'grab';
    }
    window.removeEventListener('mousemove', this.handleDragMove);
    window.removeEventListener('mouseup', this.handleDragEnd);
    window.removeEventListener('mouseleave', this.handleDragEnd);
  };

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone & camera access...');

    try {
      try {
        // First, try to get both audio and video
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });

        const videoElement = this.shadowRoot!.getElementById(
          'cameraFeed',
        ) as HTMLVideoElement;
        if (this.mediaStream.getVideoTracks().length > 0 && videoElement) {
          videoElement.srcObject = this.mediaStream;
          this.isCameraVisible = true;
        }
      } catch (videoError) {
        // If getting video fails, log it and try audio-only.
        console.warn(
          'Could not start video source, falling back to audio-only.',
          videoError,
        );
        this.updateStatus('Camera not available. Trying audio-only...');
        this.isCameraVisible = false;

        // Fallback to audio-only
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      // If we've reached here, we have a media stream (with or without video)
      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      // This outer catch handles the failure of the audio-only fallback.
      let message = 'An unknown error occurred while accessing media devices.';
      if (err instanceof Error) {
        message = err.message;
        if (err.name === 'NotAllowedError') {
          message =
            'Permission for microphone was denied. Please grant access to use the app.';
        } else if (err.name === 'NotFoundError') {
          message = 'No microphone was found on your device.';
        } else if (err.name === 'NotReadableError') {
          message =
            'Your microphone is currently in use by another application.';
        }
      }
      console.error(
        'Error starting recording (audio fallback also failed):',
        err,
      );
      this.updateError(`Error: ${message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;
    this.isCameraVisible = false;

    const videoElement = this.shadowRoot?.getElementById(
      'cameraFeed',
    ) as HTMLVideoElement;
    if (videoElement) {
      videoElement.srcObject = null;
    }

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  render() {
    return html`
      <div>
        <video
          id="cameraFeed"
          style="left: ${this.cameraPosition.x}px; top: ${this.cameraPosition
            .y}px;"
          ?hidden=${!this.isCameraVisible}
          @mousedown=${this.handleDragStart}
          autoplay
          muted
          playsinline></video>

        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}