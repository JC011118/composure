/**
 * Interviewer voice via the platform's local speech synthesizer
 * (window.speechSynthesis — no cloud). If no voice is available or the end
 * event never arrives, the engine's own fallback timer moves on.
 */

export interface SpeechHandle {
  id: number;
  text: string;
}

export class InterviewerVoice {
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null;
  muted = false;

  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  get available(): boolean {
    return this.synth !== null && !this.muted;
  }

  private pickVoice(): void {
    const voices = this.synth?.getVoices() ?? [];
    const prefer = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Google US English'];
    this.voice =
      prefer.map((n) => voices.find((v) => v.name.startsWith(n))).find(Boolean) ??
      voices.find((v) => v.lang?.startsWith('en') && v.localService) ??
      voices.find((v) => v.lang?.startsWith('en')) ??
      null;
  }

  /** Speak; `onEnd` fires when the utterance finishes (or fails). Interrupts anything in progress. */
  speak(text: string, onEnd: () => void): void {
    if (!this.synth || this.muted) {
      // Let the engine's fallback timer advance; nothing to say.
      return;
    }
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = 0.97;
      u.pitch = 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onEnd();
      };
      u.addEventListener('end', finish);
      u.addEventListener('error', finish);
      this.synth.speak(u);
    } catch {
      // Engine fallback timer covers this.
    }
  }

  cancel(): void {
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }
}
