/**
 * 输入：手机重力感应 + 键盘/触摸回退
 */
export class InputController {
  constructor() {
    this.tilt = { x: 0, z: 0 }; // 左右 / 前后，约 -1 ~ 1
    this.keys = new Set();
    this.pointer = { active: false, x: 0, z: 0 };
    this.enabled = false;
    this.hasOrientation = false;

    this._onOrientation = this._onOrientation.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    window.addEventListener('keydown', this._onKey, { passive: true });
    window.addEventListener('keyup', this._onKeyUp, { passive: true });

    const canvasHost = document.getElementById('app');
    if (canvasHost) {
      canvasHost.addEventListener('pointerdown', this._onPointerDown);
      window.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('pointerup', this._onPointerUp);
      window.addEventListener('pointercancel', this._onPointerUp);
    }
  }

  /** 在用户手势里调用（iOS 需要） */
  async enable() {
    this.enabled = true;
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state !== 'granted') return false;
      }
    } catch {
      // 桌面或不支持时忽略
    }

    window.addEventListener('deviceorientation', this._onOrientation, true);
    return true;
  }

  setCalibration() {
    // 以当前姿态为零点（手机放平时用）；有采样则做平均更稳
    if (this._samples && this._samples.length > 0) {
      const n = this._samples.length;
      let b = 0;
      let g = 0;
      for (const s of this._samples) {
        b += s.beta;
        g += s.gamma;
      }
      this._calib = { beta: b / n, gamma: g / n };
      return;
    }
    if (this._lastRaw) {
      this._calib = {
        beta: this._lastRaw.beta ?? 0,
        gamma: this._lastRaw.gamma ?? 0,
      };
    }
  }

  get vector() {
    let x = this.tilt.x;
    let z = this.tilt.z;

    // 键盘 / 点按：短时保持，避免只能“轻点”几乎没有加速度
    this._pulseTtl = Math.max(0, (this._pulseTtl || 0) - 0.016);
    const pulse = this._pulseTtl > 0 ? (this._pulse || { x: 0, z: 0 }) : { x: 0, z: 0 };

    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) z += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S')) z -= 1;

    x += pulse.x;
    z += pulse.z;

    if (this.pointer.active) {
      x += this.pointer.x;
      z += this.pointer.z;
    }

    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  _onOrientation(event) {
    if (!this.enabled) return;
    if (event.beta == null && event.gamma == null) return;

    this._lastRaw = { beta: event.beta ?? 0, gamma: event.gamma ?? 0 };
    const beta = this._lastRaw.beta;
    const gamma = this._lastRaw.gamma;

    this._samples = this._samples || [];
    this._samples.push(this._lastRaw);
    if (this._samples.length > 12) this._samples.shift();

    if (!this._calib) {
      this._calib = { beta, gamma };
    }

    // 手机放平时 beta/gamma ≈ 0
    // gamma：左右倾斜；beta：前后倾斜
    const dBeta = beta - this._calib.beta;
    const dGamma = gamma - this._calib.gamma;

    // 满量程角度调小，让小幅倾斜也能感到
    const maxSide = 14;
    const maxFB = 12;

    // 手感：往左倾 → 球往左；往前倾（远端压低）→ 球往前
    // W3C：gamma 负 = 左边下沉，beta 正 = 顶部朝地面
    // 实机上两个轴都要取反，才符合“盘子往哪倾球往哪滚”
    const gx = clamp(-dGamma / maxSide, -1, 1);
    const gz = clamp(-dBeta / maxFB, -1, 1);

    // 小死区 + 轻微平滑，降低抖动
    const dead = 0.04;
    const sx = Math.abs(gx) < dead ? 0 : gx;
    const sz = Math.abs(gz) < dead ? 0 : gz;
    const smooth = 0.35;
    this.tilt.x += (sx - this.tilt.x) * smooth;
    this.tilt.z += (sz - this.tilt.z) * smooth;
    this.hasOrientation = true;
  }

  _onKey(e) {
    this.keys.add(e.key);
    this._pulseFromKey(e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault?.();
  }

  _pulseFromKey(key) {
    let x = 0;
    let z = 0;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') x -= 1;
    if (key === 'ArrowRight' || key === 'd' || key === 'D') x += 1;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') z += 1;
    if (key === 'ArrowDown' || key === 's' || key === 'S') z -= 1;
    if (x === 0 && z === 0) return;
    this._pulse = { x, z };
    this._pulseTtl = 0.28;
  }

  _onKeyUp(e) {
    this.keys.delete(e.key);
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    this.pointer.active = true;
    this._origin = { x: e.clientX, y: e.clientY };
    this._onPointerMove(e);
  }

  _onPointerMove(e) {
    if (!this.pointer.active || !this._origin) return;
    const dx = (e.clientX - this._origin.x) / 90;
    const dy = (e.clientY - this._origin.y) / 90;
    this.pointer.x = clamp(dx, -1, 1);
    this.pointer.z = clamp(-dy, -1, 1);
  }

  _onPointerUp() {
    this.pointer.active = false;
    this.pointer.x = 0;
    this.pointer.z = 0;
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
