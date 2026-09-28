/**
 * 重力小球 · 3D 道路物理小游戏
 * 简单几何体 + 伪物理，面向手机重力感应
 */
import * as THREE from 'three';
import { InputController } from './input.js';

// ---------- 常量 ----------
const ROAD_WIDTH = 8;
const ROAD_LENGTH = 420;
const ROAD_HALF = ROAD_WIDTH / 2;
const BALL_R = 0.42;
const GRAVITY = 22;
const MOVE_ACC = 20;
const FRICTION = 1.9;
const MAX_SPEED = 15;
const FORWARD_BIAS = 1.1; // 轻微自动向前；倾斜前后应能明显加速/减速
const HOLE_R = 0.95;
const COIN_R = 0.45;
const FALL_LIMIT = -8;

const COLORS = {
  sky: 0x8aa0b5,
  fog: 0x8aa0b5,
  road: 0xe8e2d6,
  roadSide: 0xcfc6b6,
  rail: 0xd9d0c0,
  hole: 0x14171c,
  coin: 0xf5c542,
  ball: 0xf2f2f2,
  coinRing: 0xe0a91a,
};

// ---------- 场景 ----------
export class GravityBallGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.input = new InputController();
    this.state = 'idle'; // idle | playing | over
    this.score = 0;
    this.distance = 0;
    this.bestDistance = 0;

    this._clock = new THREE.Clock();
    this._raf = 0;
    this._coinAnim = 0;

    this._initRenderer();
    this._initScene();
    this._buildWorld();
    this._bindUi();
    this._resize();

    window.addEventListener('resize', () => this._resize());
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(COLORS.sky, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.fog, 18, 78);

    this.camera = new THREE.PerspectiveCamera(
      58,
      window.innerWidth / window.innerHeight,
      0.1,
      120
    );
    this.camera.position.set(0, 5.2, -7.5);
    this.camera.lookAt(0, 0.6, 4);

    const ambient = new THREE.AmbientLight(0xdde7f2, 0.72);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
    sun.position.set(10, 18, -6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0xbfd4e8, 0.35);
    fill.position.set(-8, 10, 12);
    this.scene.add(fill);
  }

  _buildWorld() {
    this.world = new THREE.Group();
    this.scene.add(this.world);

    // 道路主面
    const roadMat = new THREE.MeshStandardMaterial({
      color: COLORS.road,
      roughness: 0.92,
      metalness: 0.02,
    });
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_WIDTH, 0.35, ROAD_LENGTH),
      roadMat
    );
    road.position.set(0, -0.18, ROAD_LENGTH / 2 - 10);
    road.receiveShadow = true;
    this.world.add(road);

    // 两侧护栏（浅槽感）
    const railMat = new THREE.MeshStandardMaterial({
      color: COLORS.rail,
      roughness: 0.88,
      metalness: 0.04,
    });
    const railH = 0.55;
    const railW = 0.35;
    const leftRail = new THREE.Mesh(
      new THREE.BoxGeometry(railW, railH, ROAD_LENGTH),
      railMat
    );
    leftRail.position.set(-ROAD_HALF + railW / 2, railH / 2 - 0.1, ROAD_LENGTH / 2 - 10);
    leftRail.castShadow = true;
    leftRail.receiveShadow = true;
    this.world.add(leftRail);

    const rightRail = leftRail.clone();
    rightRail.position.x = ROAD_HALF - railW / 2;
    this.world.add(rightRail);

    // 道路边缘阴影条，增强“一条路”纵深
    const edgeMat = new THREE.MeshStandardMaterial({
      color: COLORS.roadSide,
      roughness: 0.95,
      metalness: 0,
    });
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.12, ROAD_LENGTH),
        edgeMat
      );
      edge.position.set(side * (ROAD_HALF - 0.55), 0.02, ROAD_LENGTH / 2 - 10);
      edge.receiveShadow = true;
      this.world.add(edge);
    }

    // 坑洞
    this.holes = [];
    const holeMat = new THREE.MeshStandardMaterial({
      color: COLORS.hole,
      roughness: 1,
      metalness: 0,
    });
    // 确定性布点：先近后远，难度递增
    let z = 10;
    let i = 0;
    while (z < ROAD_LENGTH - 20) {
      const pattern = i % 5;
      const xs = [];
      if (pattern === 0) xs.push(-1.4);
      else if (pattern === 1) xs.push(1.3);
      else if (pattern === 2) xs.push(-1.8, 1.6);
      else if (pattern === 3) xs.push(0);
      else xs.push(-2.2, 0, 2.0);

      for (const x of xs) {
        const hx = clampX(x);
        const hz = z + (xs.length > 1 ? Math.sin(i * 1.7) * 0.4 : 0);

        // 纯黑洞面（Basic 材质，不受灯光影响，避免被照灰）
        const hole = new THREE.Mesh(
          new THREE.CircleGeometry(HOLE_R, 36),
          new THREE.MeshBasicMaterial({ color: 0x000000 })
        );
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(hx, 0.06, hz);
        hole.renderOrder = 2;
        this.world.add(hole);

        // 内圈更黑，模拟深度
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(HOLE_R * 0.72, 28),
          new THREE.MeshBasicMaterial({ color: 0x000000 })
        );
        core.rotation.x = -Math.PI / 2;
        core.position.set(hx, 0.065, hz);
        core.renderOrder = 3;
        this.world.add(core);

        // 坑沿
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(HOLE_R * 1.01, 0.07, 8, 36),
          new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.95 })
        );
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(hx, 0.055, hz);
        rim.renderOrder = 1;
        this.world.add(rim);

        this.holes.push({ x: hx, z: hz, r: HOLE_R });
      }

      z += 11 + (i % 3) * 1.8;
      i += 1;
    }

    // 金币
    this.coins = [];
    const coinGeo = new THREE.CylinderGeometry(COIN_R, COIN_R, 0.12, 20);
    const coinMat = new THREE.MeshStandardMaterial({
      color: COLORS.coin,
      roughness: 0.45,
      metalness: 0.35,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: COLORS.coinRing,
      roughness: 0.5,
      metalness: 0.4,
    });

    let cz = 6;
    let ci = 0;
    while (cz < ROAD_LENGTH - 12) {
      const lane = ((ci % 5) - 2) * 1.15;
      const coin = new THREE.Group();
      const body = new THREE.Mesh(coinGeo, coinMat);
      body.castShadow = true;
      body.rotation.x = Math.PI / 2;
      coin.add(body);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(COIN_R * 0.62, 0.045, 8, 20),
        ringMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.07;
      coin.add(ring);

      coin.position.set(clampX(lane), 0.55, cz);
      this.world.add(coin);
      this.coins.push({ mesh: coin, x: coin.position.x, z: coin.position.z, taken: false });
      cz += 6.5 + (ci % 4) * 0.8;
      ci += 1;
    }

    // 小球
    const ballMat = new THREE.MeshStandardMaterial({
      color: COLORS.ball,
      roughness: 0.35,
      metalness: 0.08,
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), ballMat);
    this.ball.castShadow = true;
    this.ball.position.set(0, BALL_R, 0);
    this.world.add(this.ball);

    // 小球接触阴影片（简单）
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 1.15, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.ballBlob = blob;
    this.world.add(blob);

    // 物理状态
    this.vel = new THREE.Vector3(0, 0, 0);
    this.falling = false;
  }

  _bindUi() {
    this.ui = {
      startOverlay: document.getElementById('start-overlay'),
      overOverlay: document.getElementById('over-overlay'),
      hudTop: document.getElementById('hud-top'),
      hudBottom: document.getElementById('hud-bottom'),
      tiltHint: document.getElementById('tilt-hint'),
      dist: document.getElementById('dist-value'),
      score: document.getElementById('score-value'),
      discountScore: document.getElementById('discount-score'),
      discountYuan: document.getElementById('discount-yuan'),
      overTitle: document.getElementById('over-title'),
      overDist: document.getElementById('over-dist'),
      overScore: document.getElementById('over-score'),
      overDiscount: document.getElementById('over-discount'),
      btnStart: document.getElementById('btn-start'),
      btnRestart: document.getElementById('btn-restart'),
    };

    this.ui.btnStart.addEventListener('click', async () => {
      await this.input.enable();
      this.input.setCalibration();
      this.start();
    });

    this.ui.btnRestart.addEventListener('click', async () => {
      await this.input.enable();
      this.input.setCalibration();
      this.start();
    });
  }

  start() {
    this.score = 0;
    this.distance = 0;
    this.falling = false;
    this.vel.set(0, 0, 0);
    this.ball.position.set(0, BALL_R, 0);
    this.ball.rotation.set(0, 0, 0);
    this.ball.scale.setScalar(1);
    this._pop = 0;

    for (const c of this.coins) {
      c.taken = false;
      c.mesh.visible = true;
    }

    this.state = 'playing';
    this.ui.startOverlay.hidden = true;
    this.ui.overOverlay.hidden = true;
    this.ui.hudTop.hidden = false;
    this.ui.hudBottom.hidden = false;
    this.ui.tiltHint.classList.remove('is-hidden');
    this._hideHintTimer = 0;
    this._updateHud();
    this._clock.getDelta();
  }

  gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.falling = true;
    this.vel.y = -3.5;
    this.bestDistance = Math.max(this.bestDistance, Math.floor(this.distance));

    this.ui.overDist.textContent = String(Math.floor(this.distance));
    this.ui.overScore.textContent = String(this.score);
    this.ui.overDiscount.textContent = String(this.score);
    this.ui.overTitle.textContent = '掉进坑里了';
    // 稍等一下再弹结算，让掉坑动画露出来
    window.setTimeout(() => {
      if (this.state === 'over') {
        this.ui.overOverlay.hidden = false;
        this.ui.tiltHint.classList.add('is-hidden');
      }
    }, 450);
  }

  _updateHud() {
    this.ui.dist.textContent = String(Math.floor(this.distance));
    this.ui.score.textContent = String(this.score);
    this.ui.discountScore.textContent = String(this.score);
    this.ui.discountYuan.textContent = String(this.score);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // 竖屏略收 FOV，保证道路纵深
    this.camera.fov = w < h ? 60 : 52;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock.getDelta(), 0.033);
    this._coinAnim += dt;

    if (this.state === 'playing') {
      this._simulate(dt);
    } else if (this.state === 'over' && this.falling) {
      this.vel.y -= GRAVITY * dt;
      this.ball.position.addScaledVector(this.vel, dt);
    }

    this._updateCamera(dt);
    this._animateCoins();
    this.renderer.render(this.scene, this.camera);
  }

  _simulate(dt) {
    const input = this.input.vector;

    // 伪物理：倾斜 → 加速度；轻微向前偏置
    this.vel.x += input.x * MOVE_ACC * dt;
    this.vel.z += (input.z * MOVE_ACC + FORWARD_BIAS) * dt;

    // 摩擦
    this.vel.x -= this.vel.x * FRICTION * dt;
    this.vel.z -= this.vel.z * FRICTION * dt;

    // 限速
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > MAX_SPEED) {
      this.vel.x = (this.vel.x / sp) * MAX_SPEED;
      this.vel.z = (this.vel.z / sp) * MAX_SPEED;
    }

    this.ball.position.x += this.vel.x * dt;
    this.ball.position.z += this.vel.z * dt;

    // 护栏挡板
    const limit = ROAD_HALF - BALL_R - 0.25;
    if (this.ball.position.x > limit) {
      this.ball.position.x = limit;
      this.vel.x *= -0.25;
    } else if (this.ball.position.x < -limit) {
      this.ball.position.x = -limit;
      this.vel.x *= -0.25;
    }

    // 滚动视觉
    this.ball.rotation.x += this.vel.z * dt / BALL_R;
    this.ball.rotation.z -= this.vel.x * dt / BALL_R;

    // 距离
    this.distance = Math.max(this.distance, this.ball.position.z);

    // 坑洞检测
    for (const h of this.holes) {
      const dx = this.ball.position.x - h.x;
      const dz = this.ball.position.z - h.z;
      if (dx * dx + dz * dz < (h.r * 0.92) ** 2) {
        this.falling = true;
        this.vel.y = -2;
        this.gameOver();
        return;
      }
    }

    // 金币收集
    for (const c of this.coins) {
      if (c.taken) continue;
      const dx = this.ball.position.x - c.x;
      const dz = this.ball.position.z - c.z;
      if (dx * dx + dz * dz < (BALL_R + COIN_R + 0.35) ** 2) {
        c.taken = true;
        c.mesh.visible = false;
        this.score += 1;
        this._pop = 0.18;
        this._updateHud();
      }
    }

    // 吃到金币的小球短暂放大
    if (this._pop > 0) {
      this._pop = Math.max(0, this._pop - dt);
      const s = 1 + this._pop * 1.6;
      this.ball.scale.setScalar(s);
    } else {
      this.ball.scale.setScalar(1);
    }

    // 操作提示
    if (this._hideHintTimer !== undefined) {
      this._hideHintTimer += dt;
      if (this._hideHintTimer > 4.5) {
        this.ui.tiltHint.classList.add('is-hidden');
      }
    }

    this._updateHud();
  }

  _animateCoins() {
    for (const c of this.coins) {
      if (c.taken) continue;
      c.mesh.position.y = 0.55 + Math.sin(this._coinAnim * 2.2 + c.z * 0.15) * 0.08;
      c.mesh.rotation.y = this._coinAnim * 1.1 + c.z;
    }
  }

  _updateCamera(dt) {
    const ballPos = this.ball.position;
    // 跟在小球后上方，看向前进方向
    const targetX = ballPos.x * 0.35;
    const targetY = 5.0 + ballPos.y * 0.15;
    const targetZ = ballPos.z - 7.2;

    const k = 1 - Math.exp(-6 * dt);
    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;
    this.camera.position.z += (targetZ - this.camera.position.z) * k;

    this.camera.lookAt(ballPos.x * 0.5, 0.5 + ballPos.y * 0.25, ballPos.z + 6);

    // 阴影相机跟随
    if (this.sun) {
      this.sun.position.set(ballPos.x + 10, 18, ballPos.z - 6);
      this.sun.target.position.copy(ballPos);
      this.sun.target.updateMatrixWorld();
      this.scene.add(this.sun.target);
    }

    // 接触阴影
    if (this.ballBlob && !this.falling) {
      this.ballBlob.position.set(ballPos.x, 0.02, ballPos.z);
      this.ballBlob.visible = true;
    } else if (this.ballBlob) {
      this.ballBlob.visible = false;
    }
  }
}

function clampX(x) {
  return Math.max(-ROAD_HALF + 1.2, Math.min(ROAD_HALF - 1.2, x));
}
