/**
 * WhaleAnimator — 60fps HiDPI Procedural Spine & Particle Animation Engine
 * Crafted specifically for the DeepSeek Blue Whale Desktop Companion.
 */
export class WhaleAnimator {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = options.width || 300;
    this.height = options.height || 260;

    // Core state machine
    this.state = 'idle'; // idle | swimming | dragging | petting | shy | spouting | thinking | speaking | eating | sleeping
    this.stateTimer = 0; // remaining seconds for temporary action states (0 = indefinite)
    this.baseState = 'idle'; // fallback state (idle or swimming or sleeping)

    // Orientation & physics
    this.targetFacing = 1; // 1 = facing right, -1 = facing left
    this.facing = 1;
    this.dragVx = 0;
    this.dragVy = 0;
    this.springScaleX = 1;
    this.springScaleY = 1;
    this.springVelX = 0;
    this.springVelY = 0;
    this.bodyTilt = 0;

    // Eye tracking (normalized -1..1)
    this.targetLookX = 0;
    this.targetLookY = 0;
    this.lookX = 0;
    this.lookY = 0;

    // Blinking & speaking cadence
    this.blinkTimer = 2.8;
    this.blinkProgress = 0; // 0 = open, 1 = closed
    this.isBlinking = false;
    this.speakEnergy = 0;

    // Eating prop animation
    this.foodArc = null; // { t: 0..1 }

    // Particle pool (bubbles, water droplets, hearts, stars, zzz)
    this.particles = [];

    this.time = 0;
    this.lastFrameTs = performance.now();
    this.rafId = null;

    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  start() {
    if (this.rafId) return;
    this.lastFrameTs = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrameTs) / 1000);
      this.lastFrameTs = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Pixel-level alpha hit test so empty transparent space passes clicks to the desktop.
   */
  isPointOpaque(localX, localY) {
    if (localX < 0 || localY < 0 || localX >= this.width || localY >= this.height) {
      return false;
    }
    const px = Math.floor(localX * this.dpr);
    const py = Math.floor(localY * this.dpr);
    try {
      const alpha = this.ctx.getImageData(px, py, 1, 1).data[3];
      return alpha > 22;
    } catch (_) {
      return false;
    }
  }

  setLookOffset(dx, dy) {
    const maxDist = 260;
    this.targetLookX = Math.max(-1, Math.min(1, dx / maxDist));
    this.targetLookY = Math.max(-1, Math.min(1, dy / maxDist));
  }

  setBaseState(nextBase) {
    this.baseState = nextBase;
    if (this.stateTimer <= 0 && this.state !== 'dragging' && this.state !== 'thinking' && this.state !== 'speaking') {
      this.state = nextBase;
    }
  }

  setFacing(dir) {
    this.targetFacing = dir >= 0 ? 1 : -1;
  }

  triggerState(nextState, durationSec = 2.2) {
    this.state = nextState;
    this.stateTimer = durationSec;

    if (nextState === 'spouting') {
      this.triggerJellyBounce(1.12, 0.90);
      this.spawnWaterSpout(18);
    } else if (nextState === 'petting') {
      this.triggerJellyBounce(1.09, 0.92);
      this.spawnHearts(5);
    } else if (nextState === 'shy') {
      this.triggerJellyBounce(0.94, 1.07);
      this.spawnHearts(4);
    } else if (nextState === 'eating') {
      this.foodArc = { t: 0 };
    }
  }

  setPersistentActivity(activityState) {
    // activityState: 'thinking' | 'speaking' | null
    if (!activityState) {
      this.state = this.baseState;
      this.stateTimer = 0;
      return;
    }
    this.state = activityState;
    this.stateTimer = 0;
  }

  pulseSpeech() {
    this.speakEnergy = 1.0;
    if (Math.random() < 0.28) {
      this.spawnBubble(this.width * 0.5 + this.facing * 58, this.height * 0.52, 1);
    }
  }

  applyDragMotion(vx, vy) {
    this.state = 'dragging';
    this.stateTimer = 0;
    this.dragVx = this.dragVx * 0.65 + vx * 0.35;
    this.dragVy = this.dragVy * 0.65 + vy * 0.35;
    if (Math.abs(vx) > 2.5) {
      this.targetFacing = vx > 0 ? 1 : -1;
    }
    if (Math.hypot(vx, vy) > 8 && Math.random() < 0.45) {
      this.spawnBubble(
        this.width * 0.5 - this.facing * 62,
        this.height * 0.56 + (Math.random() - 0.5) * 20,
        1
      );
    }
  }

  endDrag(didMove) {
    this.dragVx = 0;
    this.dragVy = 0;
    if (didMove) {
      this.triggerJellyBounce(1.16, 0.86);
      this.spawnBubble(this.width * 0.5, this.height * 0.55, 4);
    }
    this.state = this.baseState;
  }

  triggerJellyBounce(sx = 1.12, sy = 0.89) {
    this.springScaleX = sx;
    this.springScaleY = sy;
  }

  spawnBubble(x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: 'bubble',
        x: x + (Math.random() - 0.5) * 22,
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 18,
        vy: -(24 + Math.random() * 28),
        r: 2.5 + Math.random() * 4.5,
        life: 0,
        maxLife: 1.2 + Math.random() * 0.9
      });
    }
  }

  spawnWaterSpout(count = 16) {
    const bx = this.width * 0.5 + this.facing * 18;
    const by = this.height * 0.35;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const spread = 22 + Math.random() * 58;
      this.particles.push({
        kind: 'droplet',
        x: bx + (Math.random() - 0.5) * 8,
        y: by,
        vx: side * spread + this.facing * 8,
        vy: -(115 + Math.random() * 75),
        gravity: 250,
        r: 2.5 + Math.random() * 3.2,
        color: i % 3 === 0 ? '#38BDF8' : '#60A5FA',
        life: 0,
        maxLife: 0.85 + Math.random() * 0.35
      });
    }
  }

  spawnHearts(count = 4) {
    const hx = this.width * 0.5 + this.facing * 26;
    const hy = this.height * 0.36;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: 'heart',
        x: hx + (Math.random() - 0.5) * 44,
        y: hy + (Math.random() - 0.5) * 16,
        vx: (Math.random() - 0.5) * 20,
        vy: -(32 + Math.random() * 22),
        size: 7 + Math.random() * 5,
        color: i % 2 === 0 ? '#FB7185' : '#60A5FA',
        life: 0,
        maxLife: 1.15 + Math.random() * 0.45
      });
    }
  }

  spawnStars(x, y, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 38 + Math.random() * 45;
      this.particles.push({
        kind: 'star',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 15,
        size: 4 + Math.random() * 3.5,
        life: 0,
        maxLife: 0.75 + Math.random() * 0.3
      });
    }
  }

  update(dt) {
    this.time += dt;

    // Temporary action countdown
    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.stateTimer = 0;
        this.state = this.baseState;
      }
    }

    // Smoothly turn facing direction (-1 .. +1)
    this.facing += (this.targetFacing - this.facing) * Math.min(1, dt * 8.5);
    if (Math.abs(this.facing) < 0.08) {
      this.facing = this.targetFacing >= 0 ? 0.08 : -0.08;
    }

    // Smooth eye tracking
    this.lookX += (this.targetLookX - this.lookX) * Math.min(1, dt * 9);
    this.lookY += (this.targetLookY - this.lookY) * Math.min(1, dt * 9);

    // Jelly squash-and-stretch spring physics
    const stiffness = 175;
    const damping = 14;
    this.springVelX += (1 - this.springScaleX) * stiffness * dt;
    this.springVelY += (1 - this.springScaleY) * stiffness * dt;
    this.springVelX *= Math.exp(-damping * dt);
    this.springVelY *= Math.exp(-damping * dt);
    this.springScaleX += this.springVelX * dt;
    this.springScaleY += this.springVelY * dt;

    // Drag tilt damping
    const targetTilt =
      this.state === 'dragging'
        ? Math.max(-0.38, Math.min(0.38, this.dragVy * 0.018 - this.dragVx * 0.008 * Math.sign(this.facing)))
        : this.state === 'thinking'
          ? -0.09
          : this.state === 'spouting'
            ? -0.12
            : 0;
    this.bodyTilt += (targetTilt - this.bodyTilt) * Math.min(1, dt * 10);

    // Speech mouth decay
    this.speakEnergy = Math.max(0, this.speakEnergy - dt * 2.6);

    // Natural eye blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && !this.isBlinking) {
      this.isBlinking = true;
      this.blinkProgress = 0;
    }
    if (this.isBlinking) {
      this.blinkProgress += dt * 11;
      if (this.blinkProgress >= 2) {
        this.isBlinking = false;
        this.blinkProgress = 0;
        this.blinkTimer = 2.4 + Math.random() * 3.8;
      }
    }

    // Periodic ambient particles
    if (this.state === 'sleeping' && Math.random() < dt * 1.4) {
      this.particles.push({
        kind: 'zzz',
        x: this.width * 0.5 + this.facing * 42,
        y: this.height * 0.38,
        vx: this.facing * 10,
        vy: -22,
        size: 11 + Math.random() * 4,
        life: 0,
        maxLife: 1.8
      });
    } else if (this.state !== 'sleeping' && Math.random() < dt * 0.85) {
      this.spawnBubble(this.width * 0.5 + (Math.random() - 0.5) * 80, this.height * 0.68, 1);
    }

    if (this.state === 'spouting' && Math.random() < dt * 14) {
      this.spawnWaterSpout(2);
    }

    // Eating arc update
    if (this.foodArc) {
      this.foodArc.t += dt * 1.85;
      if (this.foodArc.t >= 1) {
        const mouthX = this.width * 0.5 + this.facing * 58;
        const mouthY = this.height * 0.56;
        this.spawnStars(mouthX, mouthY, 9);
        this.triggerJellyBounce(1.13, 0.88);
        this.foodArc = null;
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.gravity) {
        p.vy += p.gravity * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    const cx = this.width * 0.5;
    const baseCy = this.height * 0.57;

    // Floating bob calculation
    let bobY = Math.sin(this.time * 2.3) * 5.5;
    let bobX = 0;
    if (this.state === 'swimming') {
      bobY = Math.sin(this.time * 4.6) * 4.5;
      bobX = Math.cos(this.time * 2.3) * 3;
    } else if (this.state === 'sleeping') {
      bobY = Math.sin(this.time * 1.1) * 3.0;
    } else if (this.state === 'spouting' || this.state === 'petting') {
      bobY = -Math.abs(Math.sin(this.time * 6.5)) * 8;
    } else if (this.state === 'shy') {
      bobX = Math.sin(this.time * 14) * 3.2;
    }

    // 1. Subtle floating ocean shadow below whale
    const shadowScale = Math.max(0.65, 1 - (bobY + 8) * 0.012);
    ctx.save();
    ctx.translate(cx + bobX, baseCy + 58);
    ctx.scale(shadowScale, 0.24);
    const shadowGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 66);
    shadowGrad.addColorStop(0, 'rgba(13, 40, 140, 0.24)');
    shadowGrad.addColorStop(1, 'rgba(13, 40, 140, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Transform into Whale local coordinate system
    ctx.save();
    ctx.translate(cx + bobX, baseCy + bobY);

    // Breathing scale
    const breath =
      this.state === 'sleeping'
        ? Math.sin(this.time * 1.3) * 0.035
        : Math.sin(this.time * 2.3) * 0.016;

    ctx.scale(
      this.facing * (this.springScaleX + breath),
      this.springScaleY - breath * 0.5
    );
    ctx.rotate(this.bodyTilt);

    this._drawWhaleCharacter(ctx);
    ctx.restore();

    // 3. Thinking DeepSeek R1 neural constellation halo (world space so upright)
    if (this.state === 'thinking') {
      this._drawThinkingConstellation(ctx, cx + bobX + Math.sign(this.facing) * 14, baseCy + bobY - 62);
    }

    // 4. Eating cyber-krill / compute crystal arc
    if (this.foodArc) {
      this._drawFoodItem(ctx, cx, baseCy + bobY);
    }

    // 5. World-space particles
    this._drawParticles(ctx);

    ctx.restore();
  }

  _drawWhaleCharacter(ctx) {
    // Dynamic tail & fin rhythms
    let tailFreq = 3.0;
    let tailAmp = 0.16;
    let finFreq = 2.8;
    let finAmp = 0.14;

    if (this.state === 'swimming') {
      tailFreq = 6.8;
      tailAmp = 0.28;
      finFreq = 5.5;
      finAmp = 0.22;
    } else if (this.state === 'petting' || this.state === 'spouting' || this.state === 'shy') {
      tailFreq = 8.5;
      tailAmp = 0.26;
      finFreq = 10.0;
      finAmp = 0.38;
    } else if (this.state === 'speaking') {
      tailFreq = 4.8;
      tailAmp = 0.20;
      finFreq = 5.2;
      finAmp = 0.24;
    } else if (this.state === 'sleeping') {
      tailFreq = 1.2;
      tailAmp = 0.07;
      finFreq = 1.2;
      finAmp = 0.06;
    }

    const dragTailLag = Math.max(-0.45, Math.min(0.45, -this.dragVy * 0.025));
    const tailSwing = Math.sin(this.time * tailFreq) * tailAmp + dragTailLag;
    const flukeLag = Math.sin(this.time * tailFreq - 0.65) * (tailAmp * 1.15);
    const finWave = Math.sin(this.time * finFreq) * finAmp;

    // --- A. Far-side Pectoral Flipper (behind body) ---
    ctx.save();
    ctx.translate(10, 26);
    ctx.rotate(-0.22 - finWave * 0.7);
    ctx.fillStyle = '#1538B8';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(10, 14, 7, 26, -3, 25);
    ctx.bezierCurveTo(-11, 22, -12, 10, -6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // --- B. Animated Tail Flukes (anchored at upward-sweeping tail tip) ---
    const tailTipX = -68;
    const tailTipY = -18 + tailSwing * 28;

    ctx.save();
    ctx.translate(tailTipX, tailTipY);
    ctx.rotate(tailSwing * 0.8 + flukeLag * 0.65);

    // Left fluke lobe
    const flukeGrad = ctx.createLinearGradient(-26, -24, 16, 10);
    flukeGrad.addColorStop(0, '#1D4ED8');
    flukeGrad.addColorStop(1, '#3B82F6');
    ctx.fillStyle = flukeGrad;

    ctx.beginPath();
    ctx.moveTo(2, 4);
    ctx.bezierCurveTo(-12, 2, -25, -9, -26, -23);
    ctx.bezierCurveTo(-16, -21, -6, -14, 1, -5);
    ctx.bezierCurveTo(5, -16, 13, -25, 24, -27);
    ctx.bezierCurveTo(23, -12, 15, 0, 4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // --- C. Main Plump DeepSeek Blue Whale Body + Upward Tail Stalk ---
    const defineBodyPath = () => {
      ctx.beginPath();
      // Start from upper dorsal back
      ctx.moveTo(-12, -39);
      // Forehead & rounded friendly melon snout (facing +X)
      ctx.bezierCurveTo(28, -46, 72, -28, 74, 6);
      // Chin & rounded belly
      ctx.bezierCurveTo(75, 39, 34, 52, -12, 40);
      // Sweeping S-curve tail peduncle underside up to tailTip
      ctx.bezierCurveTo(-40, 32, -62, 10, tailTipX, tailTipY + 4);
      // Tail peduncle upper edge curving smoothly back into dorsal back
      ctx.bezierCurveTo(-56, tailTipY - 5, -45, -18, -12, -39);
      ctx.closePath();
    };

    // Rich DeepSeek brand dorsal gradient (#4D88FF -> #1E54F7 -> #0D28F3)
    const bodyGrad = ctx.createLinearGradient(10, -45, -10, 48);
    bodyGrad.addColorStop(0, '#4F8BFF');
    bodyGrad.addColorStop(0.52, '#2458FA');
    bodyGrad.addColorStop(1, '#1034DC');

    ctx.save();
    defineBodyPath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Clip inside whale silhouette for creamy white belly & ventral grooves
    ctx.clip();

    // Creamy polar-white belly patch
    const bellyGrad = ctx.createLinearGradient(15, 8, 15, 52);
    bellyGrad.addColorStop(0, '#F3F8FF');
    bellyGrad.addColorStop(1, '#DCEBFF');
    ctx.fillStyle = bellyGrad;
    ctx.beginPath();
    ctx.moveTo(-42, 22);
    ctx.bezierCurveTo(-8, 8, 46, 7, 80, 18);
    ctx.lineTo(82, 60);
    ctx.lineTo(-48, 60);
    ctx.closePath();
    ctx.fill();

    // Signature Blue Whale ventral pleats (grooves)
    ctx.strokeStyle = 'rgba(128, 180, 252, 0.78)';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    for (const yOff of [18, 26, 34]) {
      ctx.beginPath();
      ctx.moveTo(-26, yOff + 5);
      ctx.bezierCurveTo(4, yOff + 13, 38, yOff + 12, 64, yOff + 2);
      ctx.stroke();
    }

    // Soft 3D glossy forehead highlight (pure radial/linear alpha — zero dark halo)
    const specGrad = ctx.createLinearGradient(25, -36, 25, -14);
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.ellipse(26, -25, 26, 8.5, 0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // End body clip

    // --- D. Cute Rounded Dorsal Fin on Back ---
    ctx.fillStyle = '#2A63FC';
    ctx.beginPath();
    ctx.moveTo(-22, -33);
    ctx.bezierCurveTo(-28, -49, -20, -52, -7, -38);
    ctx.closePath();
    ctx.fill();

    // Blowhole tiny indent on top of head (pulses open during spouting)
    ctx.fillStyle = '#1233B5';
    const blowScale = this.state === 'spouting' ? 1.5 : 1.0;
    ctx.beginPath();
    ctx.ellipse(18, -37, 4.2 * blowScale, 1.7 * blowScale, -0.08, 0, Math.PI * 2);
    ctx.fill();

    // Twin continuous water arcs while spouting
    if (this.state === 'spouting') {
      ctx.save();
      ctx.strokeStyle = 'rgba(96, 185, 255, 0.88)';
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      const pulse = Math.sin(this.time * 18) * 3;

      ctx.beginPath();
      ctx.moveTo(17, -38);
      ctx.bezierCurveTo(15, -62, 2, -74 + pulse, -12, -64);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(20, -38);
      ctx.bezierCurveTo(23, -64, 37, -75 - pulse, 50, -64);
      ctx.stroke();
      ctx.restore();
    }

    // --- E. Near-side Expressive Pectoral Flipper ---
    ctx.save();
    ctx.translate(4, 14);
    ctx.rotate(0.18 + finWave);
    const finGrad = ctx.createLinearGradient(0, 0, -22, 28);
    finGrad.addColorStop(0, '#3674FF');
    finGrad.addColorStop(1, '#1845D6');
    ctx.fillStyle = finGrad;
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.bezierCurveTo(-12, 2, -25, 19, -19, 30);
    ctx.bezierCurveTo(-10, 34, 7, 19, 9, 4);
    ctx.closePath();
    ctx.fill();

    // Flipper rim highlight
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.65)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.bezierCurveTo(-10, 6, -18, 17, -16, 25);
    ctx.stroke();
    ctx.restore();

    // --- F. Face: Eyes, Blush & Animated Mouth ---
    this._drawFace(ctx);
  }

  _drawFace(ctx) {
    const ex = 43;
    const ey = -7;

    // Rosy cheek blush (stronger when petting/shy/happy)
    const blushAlpha =
      this.state === 'shy'
        ? 0.72
        : this.state === 'petting' || this.state === 'spouting'
          ? 0.58
          : 0.34;
    ctx.fillStyle = `rgba(255, 126, 168, ${blushAlpha})`;
    ctx.beginPath();
    ctx.ellipse(36, 5.5, 8.2, 4.4, 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Eye rendering by state
    if (this.state === 'sleeping') {
      // Peaceful sleeping closed eye ∪
      ctx.strokeStyle = '#0B163B';
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey, 7.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (this.state === 'petting' || this.state === 'shy') {
      // Happy squinted smiling eye ^
      ctx.strokeStyle = '#0B163B';
      ctx.lineWidth = 3.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 2, 7.5, 1.15 * Math.PI, 1.88 * Math.PI);
      ctx.stroke();
    } else if (this.state === 'dragging') {
      // Cute surprised wide eye O
      ctx.fillStyle = '#0B163B';
      ctx.beginPath();
      ctx.arc(ex, ey, 9.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex - 2.5, ey - 2.8, 3.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Standard glossy DeepSeek Whale eye with real-time cursor pupil tracking + blinking
      const closedRatio = this.isBlinking
        ? 1 - Math.abs(1 - this.blinkProgress)
        : 0;
      const openScaleY = Math.max(0.08, 1 - closedRatio);

      // Adjust pupil offset based on facing direction
      const px = this.lookX * Math.sign(this.facing) * 2.8;
      const py = (this.state === 'thinking' ? -2.6 : this.lookY * 2.6);

      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, openScaleY);

      // Dark obsidian eye base
      ctx.fillStyle = '#0A1538';
      ctx.beginPath();
      ctx.arc(0, 0, 8.8, 0, Math.PI * 2);
      ctx.fill();

      // Lower azure iris glow
      ctx.fillStyle = '#2563EB';
      ctx.beginPath();
      ctx.arc(px * 0.7 + 1, py * 0.7 + 2.2, 5.4, 0, Math.PI * 2);
      ctx.fill();

      // Primary sparkly white catchlight
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px - 2.6, py - 2.8, 3.1, 0, Math.PI * 2);
      ctx.fill();

      // Secondary tiny catchlight
      ctx.beginPath();
      ctx.arc(px + 2.8, py + 2.4, 1.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Curious raised eyebrow when thinking
      if (this.state === 'thinking') {
        ctx.strokeStyle = '#0E2469';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 6, ey - 13);
        ctx.quadraticCurveTo(ex, ey - 17, ex + 6, ey - 12);
        ctx.stroke();
      }
    }

    // Mouth rendering by state
    ctx.strokeStyle = '#0D2159';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    if (this.state === 'dragging') {
      // Cute surprised little 'o' mouth
      ctx.fillStyle = '#FB7185';
      ctx.beginPath();
      ctx.ellipse(57, 6, 3.6, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (this.state === 'eating') {
      // Chomping happy open mouth
      const chomp = Math.abs(Math.sin(this.time * 14));
      ctx.fillStyle = '#FB7185';
      ctx.beginPath();
      ctx.arc(56, 3, 4 + chomp * 4.5, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (this.state === 'speaking' || this.speakEnergy > 0.08) {
      // Animated speaking mouth
      const talkOpen =
        0.3 + 0.7 * Math.abs(Math.sin(this.time * 15)) * Math.max(0.45, this.speakEnergy);
      ctx.fillStyle = '#F472B6';
      ctx.beginPath();
      ctx.moveTo(50, 3);
      ctx.quadraticCurveTo(57, 3 + talkOpen * 9.5, 63, 2);
      ctx.quadraticCurveTo(57, 4, 50, 3);
      ctx.fill();
      ctx.stroke();
    } else if (this.state === 'thinking') {
      // Cute wavy pondering mouth
      ctx.beginPath();
      ctx.moveTo(50, 5);
      ctx.quadraticCurveTo(54, 3, 57, 5);
      ctx.quadraticCurveTo(60, 7, 63, 4);
      ctx.stroke();
    } else {
      // Signature friendly DeepSeek whale smile
      ctx.beginPath();
      ctx.moveTo(50, 3);
      ctx.bezierCurveTo(54, 9, 60, 8.5, 64, 2);
      ctx.stroke();
    }
  }

  _drawThinkingConstellation(ctx, hx, hy) {
    ctx.save();
    // Orbiting DeepSeek R1 neural nodes
    const nodes = [];
    for (let i = 0; i < 4; i++) {
      const angle = this.time * 2.4 + (i * Math.PI) / 2;
      const nx = hx + Math.cos(angle) * 22;
      const ny = hy + Math.sin(angle) * 7.5;
      nodes.push({ x: nx, y: ny });
    }

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      ctx.fillStyle = i % 2 === 0 ? '#38BDF8' : '#818CF8';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center glowing core
    const pulse = 3.8 + Math.sin(this.time * 6) * 1.2;
    ctx.fillStyle = '#E0F2FE';
    ctx.beginPath();
    ctx.arc(hx, hy, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawFoodItem(ctx, cx, cy) {
    const t = this.foodArc.t;
    const startX = cx + Math.sign(this.facing) * 115;
    const startY = cy - 65;
    const endX = cx + Math.sign(this.facing) * 56;
    const endY = cy + 4;

    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t - Math.sin(t * Math.PI) * 38;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-t * 1.4);
    // Cute glowing cyan cyber-fish snack
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(14, -5);
    ctx.lineTo(14, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-4, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      const progress = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - Math.pow(progress, 1.6));

      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.kind === 'bubble') {
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.92)';
        ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.32, p.y - p.r * 0.32, p.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'droplet') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'heart') {
        ctx.translate(p.x, p.y);
        const s = p.size;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.35);
        ctx.bezierCurveTo(-s * 0.8, -s * 0.3, -s * 0.45, -s * 0.95, 0, -s * 0.35);
        ctx.bezierCurveTo(s * 0.45, -s * 0.95, s * 0.8, -s * 0.3, 0, s * 0.35);
        ctx.fill();
      } else if (p.kind === 'star') {
        ctx.translate(p.x, p.y);
        ctx.rotate(progress * 3);
        ctx.fillStyle = '#FBBF24';
        const r = p.size;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.38, Math.sin(a + Math.PI / 4) * r * 0.38);
        }
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'zzz') {
        ctx.fillStyle = '#93C5FD';
        ctx.font = `700 ${Math.round(p.size)}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText('Z', p.x, p.y);
      }

      ctx.restore();
    }
  }
}
