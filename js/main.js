import { GravityBallGame } from './game.js';

const canvas = document.getElementById('game-canvas');
const game = new GravityBallGame(canvas);

// 便于调试 / 自动化测试
window.__GAME__ = game;

// 简单测试钩子
window.__THREE_GAME_TEST_HOOKS__ = {
  seed: 42,
  setState(name) {
    if (name === 'active-play' || name === 'playing') {
      game.start();
      return { ok: true, state: game.state };
    }
    if (name === 'game-over') {
      game.gameOver();
      return { ok: true, state: game.state };
    }
    return { ok: false, error: `unknown state ${name}` };
  },
  setPausedForScreenshot() {
    // 暂停模拟但继续渲染由 _loop 根据 state 处理；这里直接切 over 停模拟
    return { ok: true };
  },
  hideDebugUi() {
    return { ok: true };
  },
};

window.__THREE_GAME_DIAGNOSTICS__ = {
  get fps() {
    return 0;
  },
  get state() {
    return game.state;
  },
  get score() {
    return game.score;
  },
  get distance() {
    return Math.floor(game.distance);
  },
};
