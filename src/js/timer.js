// timer.js — Per-question and total exam countdown timers

export class QuestionTimer {
  constructor(seconds, onTick, onExpire) {
    this.total = seconds;
    this.remaining = seconds;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this._raf = null;
    this._runId = 0;
    this._startTime = null;
    this._startRemaining = null;
  }

  start() {
    this.stop();
    const runId = this._runId;
    this._startTime = performance.now();
    this._startRemaining = this.remaining;
    const tick = (now) => {
      if (runId !== this._runId) return;
      const elapsed = (now - this._startTime) / 1000;
      const exact = Math.max(0, this._startRemaining - elapsed);
      this.remaining = exact;
      this.onTick(exact, this.total);
      if (runId !== this._runId) return;
      if (exact <= 0) {
        this._raf = null;
        this.onExpire();
        return;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this._runId += 1;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  reset(seconds) {
    this.stop();
    this.total = seconds;
    this.remaining = seconds;
    this._startTime = null;
    this._startRemaining = null;
  }
}

export class ExamTimer {
  constructor(totalSeconds, onTick, onExpire) {
    this.remaining = totalSeconds;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this._interval = null;
    this._startTime = null;
    this._startRemaining = null;
  }

  start() {
    this.stop();
    this._startTime = performance.now();
    this._startRemaining = this.remaining;
    this._interval = setInterval(() => {
      const elapsed = (performance.now() - this._startTime) / 1000;
      this.remaining = Math.max(0, Math.ceil(this._startRemaining - elapsed));
      this.onTick(this.remaining);
      if (this.remaining <= 0) {
        this.stop();
        this.onExpire();
      }
    }, 250);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}

export function formatTime(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatQuestionSeconds(seconds) {
  return `${Math.max(0, Math.floor(seconds))} s`;
}
