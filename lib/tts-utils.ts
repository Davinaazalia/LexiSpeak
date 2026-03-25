/**
 * Text-to-Speech Utility
 * Uses browser's native Speech Synthesis API for cross-platform compatibility
 */

export interface TTSOptions {
  rate?: number; // 0.1 to 10, default 1
  pitch?: number; // 0 to 2, default 1
  volume?: number; // 0 to 1, default 1
  voiceIndex?: number; // Which voice to use from available voices
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export const ttsUtils = {
  /**
   * Check if Speech Synthesis is supported
   */
  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  },

  /**
   * Get available voices
   */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) return [];
    return window.speechSynthesis.getVoices();
  },

  /**
   * Speak text using browser's native TTS
   */
  speak(
    text: string,
    options: TTSOptions = {},
    onComplete?: () => void
  ): void {
    if (!this.isSupported()) {
      console.warn("Speech Synthesis not supported");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Apply options
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    // Try to use a good voice (prefer natural over robotic)
    const voices = this.getVoices();
    if (voices.length > 0 && options.voiceIndex !== undefined) {
      utterance.voice = voices[options.voiceIndex];
    } else if (voices.length > 0) {
      // Default: prefer Google English voices or first available
      const preferredVoice = voices.find(
        (v) => v.lang.includes("en") && v.name.includes("Google")
      ) || voices.find((v) => v.lang.includes("en")) || voices[0];
      utterance.voice = preferredVoice;
    }

    // Handle completion
    if (onComplete) {
      utterance.onend = onComplete;
      utterance.onerror = () => onComplete();
    }

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  },

  /**
   * Stop current speech
   */
  stop(): void {
    if (!this.isSupported()) return;
    window.speechSynthesis.cancel();
    currentUtterance = null;
  },

  /**
   * Pause current speech
   */
  pause(): void {
    if (!this.isSupported()) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
  },

  /**
   * Resume paused speech
   */
  resume(): void {
    if (!this.isSupported()) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  },

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    if (!this.isSupported()) return false;
    return window.speechSynthesis.speaking;
  },

  /**
   * Check if currently paused
   */
  isPaused(): boolean {
    if (!this.isSupported()) return false;
    return window.speechSynthesis.paused;
  },
};
