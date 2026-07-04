// 初期化とレンダリングループ。
// シーン構築 → ammo.js 初期化 → UI 配線 → ループ開始。

import * as THREE from 'three';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { CameraRig } from './camera.js';
import { MMDFileLoader } from './loader.js';
import { initUI } from './ui.js';

// index.html の <script src> と同じバージョンに揃えること
const AMMO_CDN_DIR = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/';

const state = {
  mesh: null,          // 現在表示中の SkinnedMesh
  animation: null,     // バインド済み AnimationClip
  registered: false,   // helper に add 済みか
  playing: true,       // false の間は helper.update を止める（物理も止まる）
  physicsOn: true,
  physicsAvailable: false,
};

// ---- シーン構築 ----

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeceef1);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 12, 28);

scene.add(new THREE.AmbientLight(0xffffff, 2.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(6, 20, 12);
scene.add(dirLight);

const grid = new THREE.GridHelper(40, 40, 0xb9bdc9, 0xd7dae2);
scene.add(grid);

const rig = new CameraRig(camera, renderer.domElement);
rig.controls.target.set(0, 10, 0);

const helper = new MMDAnimationHelper();
const fileLoader = new MMDFileLoader();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- ammo.js（物理）初期化 ----

async function initAmmo() {
  if (typeof Ammo === 'undefined') return false;
  try {
    // MMDPhysics はグローバルの Ammo（初期化済みライブラリ）を参照する
    const lib = await Ammo({ locateFile: (file) => AMMO_CDN_DIR + file });
    window.Ammo = lib;
    return true;
  } catch (e) {
    console.warn('ammo.js の初期化に失敗しました。物理演算は無効になります。', e);
    return false;
  }
}

// ---- モデル・モーションの登録 ----

// helper への登録をやり直す（アニメーションの後付けバインドは
// MMDAnimationHelper が対応していないため、remove → add で再登録する）
function rebindToHelper() {
  if (!state.mesh) return;
  if (state.registered) {
    helper.remove(state.mesh);
    state.registered = false;
  }
  state.mesh.pose(); // 物理で動いた姿勢をバインドポーズに戻してから登録する

  const params = { physics: state.physicsAvailable };
  if (state.animation) params.animation = state.animation;
  helper.add(state.mesh, params);
  state.registered = true;

  helper.enable('physics', state.physicsAvailable && state.physicsOn);
}

function removeCurrentModel() {
  if (!state.mesh) return;
  if (state.registered) {
    helper.remove(state.mesh);
    state.registered = false;
  }
  scene.remove(state.mesh);
  state.mesh.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });
  state.mesh = null;
  state.animation = null;
}

async function onModelFiles(files) {
  ui.setStatus('モデル読込中…', true);
  try {
    const mesh = await fileLoader.loadModel(files);
    removeCurrentModel();
    state.mesh = mesh;
    state.animation = null;
    scene.add(mesh);
    rebindToHelper();
    rig.frameObject(mesh);
    ui.setPlayEnabled(false);
    ui.setStatus('モデルを読み込みました');
  } catch (e) {
    console.error(e);
    ui.setStatus('モデル読込失敗: ' + e.message);
  }
}

async function onMotionFiles(files) {
  if (!state.mesh) {
    ui.setStatus('先にモデルを読み込んでください');
    return;
  }
  ui.setStatus('モーション読込中…', true);
  try {
    const clip = await fileLoader.loadAnimation(files, state.mesh);
    state.animation = clip;
    rebindToHelper();
    state.playing = true;
    ui.setPlaying(true);
    ui.setPlayEnabled(true);
    ui.setStatus('モーションを読み込みました');
  } catch (e) {
    console.error(e);
    ui.setStatus('モーション読込失敗: ' + e.message);
  }
}

// ---- UI ----

const ui = initUI({
  onModelFiles,
  onMotionFiles,

  onTogglePlay() {
    state.playing = !state.playing;
    ui.setPlaying(state.playing);
  },

  async onToggleGyro() {
    if (rig.gyroEnabled) {
      rig.disableGyro();
      ui.setGyroActive(false);
      return;
    }
    try {
      // iOS の許可プロンプトのため、click ハンドラから直接呼ぶ
      await rig.enableGyro(() => {
        ui.setGyroActive(false);
        ui.setStatus('姿勢センサーの値を取得できません（非対応環境の可能性）');
      });
      ui.setGyroActive(true);
      ui.setStatus('姿勢カメラ ON — 端末を傾けてみてください');
    } catch (e) {
      ui.setGyroActive(false);
      ui.setStatus(e.message);
    }
  },

  onTogglePhysics() {
    if (!state.physicsAvailable) return;
    state.physicsOn = !state.physicsOn;
    helper.enable('physics', state.physicsOn);
    ui.setPhysicsActive(state.physicsOn);
  },
});

// PC など姿勢センサーが無い環境ではトグルを無効化表示する
if (typeof DeviceOrientationEvent === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) {
  ui.setGyroEnabled(false);
}

// ---- 起動 ----

ui.setStatus('物理エンジン初期化中…', true);
initAmmo().then((ok) => {
  state.physicsAvailable = ok;
  if (!ok) {
    state.physicsOn = false;
    ui.setPhysicsActive(false);
    ui.setPhysicsEnabled(false);
    ui.setStatus('物理演算は利用できません（ammo.js 読込失敗）');
  } else {
    ui.setStatus('「モデル」からPMXファイル（テクスチャ込み）を選択してください');
  }
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.1); // タブ復帰時の巨大 delta で物理が暴れるのを防ぐ
  if (state.registered && state.playing) helper.update(delta);
  rig.update(delta);
  renderer.render(scene, camera);
});
