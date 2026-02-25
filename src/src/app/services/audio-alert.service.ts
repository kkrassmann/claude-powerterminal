/**
 * Audio notification service using Web Audio API for terminal status alerts.
 *
 * Features:
 * - Three distinct notification sounds (WAITING chime, ERROR buzz, DONE descending)
 * - Priority-based debouncing to coalesce rapid status changes
 * - Global mute toggle with localStorage persistence
 * - Lazy AudioContext initialization to avoid autoplay policy issues
 */

import { Injectable } from '@angular/core';
import { TerminalStatus } from '../../../shared/ws-protocol';

@Injectable({
  providedIn: 'root'
})
export class AudioAlertService {
  private audioCtx: AudioContext | null = null;
  private muted: boolean;
  private debounceTimer: any = null;
  private cooldownTimer: any = null;
  private pendingAlert: { status: TerminalStatus; priority: number } | null = null;

  // Priority map: ERROR highest, WAITING medium, DONE lowest
  private readonly PRIORITY_MAP: Record<TerminalStatus, number> = {
    ERROR: 3,
    WAITING: 2,
    DONE: 1,
    WORKING: 0,
    THINKING: 0
  };

  constructor() {
    // Initialize mute state from localStorage
    this.muted = localStorage.getItem('audio-muted') === 'true';
  }

  /**
   * Get current mute state.
   */
  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Toggle mute state and persist to localStorage.
   */
  toggleMute(): void {
    this.muted = !this.muted;
    localStorage.setItem('audio-muted', String(this.muted));
    console.log(`[AudioAlert] Mute ${this.muted ? 'enabled' : 'disabled'}`);
  }

  /**
   * Trigger an audio alert for a status change.
   * Handles debouncing and priority logic.
   *
   * @param status - Terminal status that triggered the alert
   */
  alert(status: TerminalStatus): void {
    if (this.muted) {
      return;
    }

    const priority = this.PRIORITY_MAP[status];
    if (priority === 0) {
      return; // No alert for WORKING/THINKING
    }

    // If we're in cooldown, accumulate to pendingAlert (highest priority wins)
    if (this.cooldownTimer !== null) {
      if (!this.pendingAlert || priority > this.pendingAlert.priority) {
        this.pendingAlert = { status, priority };
      }
      return;
    }

    // If we have a pending alert with higher or equal priority, skip this one
    if (this.pendingAlert && priority <= this.pendingAlert.priority) {
      return;
    }

    // Update pending alert to this one
    this.pendingAlert = { status, priority };

    // If no debounce timer running, start one (100ms initial delay)
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;

        // Play the accumulated highest-priority alert
        if (this.pendingAlert) {
          this.playSound(this.pendingAlert.status);

          // Start 2-second cooldown period
          this.cooldownTimer = setTimeout(() => {
            this.cooldownTimer = null;

            // If we accumulated another alert during cooldown, play it now
            if (this.pendingAlert) {
              this.playSound(this.pendingAlert.status);
              this.pendingAlert = null;
            }
          }, 2000);

          this.pendingAlert = null;
        }
      }, 100);
    }
  }

  /**
   * Play the appropriate sound for a given status.
   */
  private playSound(status: TerminalStatus): void {
    const ctx = this.getContext();
    if (!ctx) {
      return;
    }

    switch (status) {
      case 'WAITING':
        this.playWaitingChime(ctx);
        break;
      case 'ERROR':
        this.playErrorTone(ctx);
        break;
      case 'DONE':
        this.playDoneChime(ctx);
        break;
    }
  }

  /**
   * Play WAITING chime: 2-note rising (C5 -> E5).
   */
  private playWaitingChime(ctx: AudioContext): void {
    this.playNote(ctx, 523.25, 0.15, 0, 'sine');      // C5
    this.playNote(ctx, 659.25, 0.2, 0.15, 'sine');    // E5
  }

  /**
   * Play ERROR tone: Low buzzy alert (A3).
   */
  private playErrorTone(ctx: AudioContext): void {
    this.playNote(ctx, 220, 0.3, 0, 'sawtooth');      // A3
  }

  /**
   * Play DONE chime: 3-note descending (G5 -> E5 -> C5).
   */
  private playDoneChime(ctx: AudioContext): void {
    this.playNote(ctx, 783.99, 0.12, 0, 'sine');      // G5
    this.playNote(ctx, 659.25, 0.12, 0.12, 'sine');   // E5
    this.playNote(ctx, 523.25, 0.2, 0.24, 'sine');    // C5
  }

  /**
   * Play a single note with specified frequency, duration, delay, and waveform.
   * Uses exponential gain ramp to avoid click artifacts.
   *
   * @param ctx - AudioContext
   * @param frequency - Frequency in Hz
   * @param duration - Duration in seconds
   * @param delay - Delay before starting in seconds
   * @param type - Oscillator waveform type
   */
  private playNote(
    ctx: AudioContext,
    frequency: number,
    duration: number,
    delay: number,
    type: OscillatorType
  ): void {
    const now = ctx.currentTime;
    const startTime = now + delay;
    const endTime = startTime + duration;

    // Create oscillator
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    // Create gain node for volume control and fade-out
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    gain.gain.setValueAtTime(0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, endTime);

    // Connect: oscillator -> gain -> destination
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Schedule start and stop
    osc.start(startTime);
    osc.stop(endTime);
  }

  /**
   * Lazily initialize AudioContext and resume if suspended.
   */
  private getContext(): AudioContext | null {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
      } catch (error) {
        console.error('[AudioAlert] Failed to create AudioContext:', error);
        return null;
      }
    }

    // Resume if suspended (autoplay policy)
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(err => {
        console.error('[AudioAlert] Failed to resume AudioContext:', err);
      });
    }

    return this.audioCtx;
  }
}
