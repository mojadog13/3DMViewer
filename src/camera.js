// カメラ制御：OrbitControls（スワイプ回転・ピンチズーム）＋姿勢カメラの合成。
//
// 姿勢カメラは DeviceOrientation の傾きデルタを「注視点固定のまま
// カメラ位置を平行移動するパララックス」として写像する。回転を直接
// カメラに適用するより「フィギュアを手に持って傾けている」感覚に近い。
// スワイプ回転（OrbitControls）がベース角度、姿勢はその上のオフセット。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ===== 姿勢カメラ調整パラメータ（実機で体感調整する） =====
export const GYRO_PARAMS = {
  MAX_TILT_DEG: 25,    // このデルタ角で最大オフセットに達する
  OFFSET_RATIO: 0.45,  // 最大オフセット量（注視距離に対する比率）
  SMOOTH_TAU: 0.10,    // ローパスフィルタの時定数[s]。小さいほど機敏、大きいほど滑らか
  SIGN_X: 1,           // 端末を右に傾けたときカメラが右へ回り込む向き
  SIGN_Y: -1,          // 端末上端を奥へ倒したときカメラが上から覗き込む向き
};

// 注: 写像はポートレート（縦持ち）前提。横持ち時の軸入れ替えは MVP 後の課題。

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 90;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.92;

    this.gyroEnabled = false;
    this._raw = null;      // 最新の deviceorientation 値
    this._base = null;     // トグル ON 時の基準姿勢（この持ち方がニュートラル）
    this._smoothed = { x: 0, y: 0 };
    this._basePos = new THREE.Vector3();
    this._hasOffset = false;
    this._gotEvent = false;
    this._unsupportedTimer = 0;

    this._onOrient = (e) => {
      if (e.beta === null || e.gamma === null) return;
      this._gotEvent = true;
      this._raw = { beta: e.beta, gamma: e.gamma };
      if (!this._base) this._base = { beta: e.beta, gamma: e.gamma };
    };

    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._forward = new THREE.Vector3();
  }

  // 姿勢カメラを ON にする。iOS Safari の許可プロンプトは
  // ユーザージェスチャ内で呼ばれる必要があるため、このメソッドは
  // ボタンの click ハンドラから直接呼ぶこと。
  // onUnsupported: イベントが一定時間来なかったとき（PC 等）に呼ばれる。
  async enableGyro(onUnsupported) {
    if (typeof DeviceOrientationEvent === 'undefined') {
      throw new Error('この環境は姿勢センサーに対応していません');
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') throw new Error('センサーの利用が許可されませんでした');
    }
    this._base = null;
    this._raw = null;
    this._gotEvent = false;
    window.addEventListener('deviceorientation', this._onOrient);
    this.gyroEnabled = true;

    clearTimeout(this._unsupportedTimer);
    this._unsupportedTimer = setTimeout(() => {
      if (!this._gotEvent && this.gyroEnabled) {
        this.disableGyro();
        if (onUnsupported) onUnsupported();
      }
    }, 1500);
  }

  disableGyro() {
    clearTimeout(this._unsupportedTimer);
    window.removeEventListener('deviceorientation', this._onOrient);
    this.gyroEnabled = false;
    this._base = null;
    this._raw = null;
    // _smoothed はゼロに向かって減衰させ、カメラが滑らかに戻るようにする
  }

  // 毎フレーム呼ぶ。OrbitControls の更新 → ジャイロオフセット適用の順。
  update(delta) {
    // 前フレームで加えたオフセットを外してから OrbitControls を更新する
    // （OrbitControls はカメラ位置から内部状態を再計算するため、
    //  オフセットが残っているとフィードバックループになる）
    if (this._hasOffset) {
      this.camera.position.copy(this._basePos);
      this._hasOffset = false;
    }
    this.controls.update();

    // 目標オフセット（-1〜1 に正規化した傾き）
    let tx = 0;
    let ty = 0;
    if (this.gyroEnabled && this._raw && this._base) {
      const max = GYRO_PARAMS.MAX_TILT_DEG;
      const dGamma = wrapDeg(this._raw.gamma - this._base.gamma);
      const dBeta = wrapDeg(this._raw.beta - this._base.beta);
      tx = THREE.MathUtils.clamp(dGamma / max, -1, 1) * GYRO_PARAMS.SIGN_X;
      ty = THREE.MathUtils.clamp(dBeta / max, -1, 1) * GYRO_PARAMS.SIGN_Y;
    }

    // ローパスフィルタ（フレームレート非依存）
    const k = 1 - Math.exp(-delta / GYRO_PARAMS.SMOOTH_TAU);
    this._smoothed.x += (tx - this._smoothed.x) * k;
    this._smoothed.y += (ty - this._smoothed.y) * k;

    if (Math.abs(this._smoothed.x) < 1e-4 && Math.abs(this._smoothed.y) < 1e-4) return;

    // カメラのローカル右・上方向へ平行移動し、注視点は固定
    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const amp = dist * GYRO_PARAMS.OFFSET_RATIO;

    this._forward.subVectors(target, this.camera.position).normalize();
    this._right.crossVectors(this._forward, this.camera.up).normalize();
    this._up.crossVectors(this._right, this._forward).normalize();

    this._basePos.copy(this.camera.position);
    this.camera.position
      .addScaledVector(this._right, this._smoothed.x * amp)
      .addScaledVector(this._up, this._smoothed.y * amp);
    this.camera.lookAt(target);
    this._hasOffset = true;
  }

  // モデルの高さに合わせて注視点とカメラ距離を調整する
  frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const height = box.max.y - box.min.y;
    const centerY = box.min.y + height * 0.55;
    this.controls.target.set(0, centerY, 0);
    this.camera.position.set(0, centerY, Math.max(height * 1.7, 10));
    this.controls.update();
  }
}

// 角度差を -180〜180 に正規化（beta の折り返し対策）
function wrapDeg(d) {
  return ((d + 180) % 360 + 360) % 360 - 180;
}
