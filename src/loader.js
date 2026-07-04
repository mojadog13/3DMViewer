// PMX/VMD のローカルファイル読み込み層。
//
// MMDLoader は URL ベースで動作し、モデル形式（pmx/pmd）も URL の拡張子で
// 判別する。Blob URL には拡張子が無いため、Blob URL を直接渡すのではなく
// 「仮想パス（VIRTUAL_PREFIX + 相対パス）」を渡し、LoadingManager の
// setURLModifier で仮想パス → Blob URL に解決する。
// テクスチャの相対パスも同じ仕組みで解決する。
//
// パス照合時はファイル名の大文字小文字・パス区切り（\ と /）・
// Unicode 正規化（NFC）の揺れを吸収する。

import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';

const VIRTUAL_PREFIX = 'mmd-virtual/';

function normalizePath(p) {
  let s = String(p);
  try { s = decodeURIComponent(s); } catch (_) { /* % を含む生パスはそのまま */ }
  s = s.replace(/\\/g, '/');
  if (s.normalize) s = s.normalize('NFC');
  return s.toLowerCase();
}

// "a/b/../c" → "a/c"、先頭の "./" 等を除去
function collapsePath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

export class MMDFileLoader {
  constructor() {
    // 正規化済み相対パス → Blob URL
    this.entries = new Map();
    // ファイル名（basename）のみ → Blob URL（フォールバック照合用）
    this.byName = new Map();
    this._objectUrls = [];

    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier((url) => this._resolveUrl(url));
    this.manager.onError = (url) => console.warn('[MMDFileLoader] 読み込めないリソース:', url);

    this.loader = new MMDLoader(this.manager);
  }

  // File 群を登録し、正規化済み相対パスのキー一覧を返す
  registerFiles(files) {
    const keys = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      this._objectUrls.push(url);
      const rel = collapsePath(normalizePath(file.webkitRelativePath || file.name));
      this.entries.set(rel, url);
      const base = rel.split('/').pop();
      // 同名ファイルは先勝ち（モデル本体側を優先させるため）
      if (!this.byName.has(base)) this.byName.set(base, url);
      keys.push(rel);
    }
    return keys;
  }

  _resolveUrl(url) {
    const idx = url.indexOf(VIRTUAL_PREFIX);
    if (idx < 0) return url; // blob:, data:, 外部 URL はそのまま

    const wanted = collapsePath(normalizePath(url.slice(idx + VIRTUAL_PREFIX.length)));

    // 1. 完全一致
    const exact = this.entries.get(wanted);
    if (exact) return exact;

    // 2. 末尾一致（フォルダ選択時、先頭にフォルダ名が付くケース）
    for (const [key, blobUrl] of this.entries) {
      if (key.endsWith('/' + wanted)) return blobUrl;
    }

    // 3. ファイル名のみで照合（フラットな複数選択でサブフォルダ情報が無いケース、
    //    PMX 内に絶対パスが書かれているケース）
    const base = wanted.split('/').pop();
    const byName = this.byName.get(base);
    if (byName) return byName;

    console.warn('[MMDFileLoader] 対応するファイルが見つかりません:', wanted);
    return url;
  }

  // 選択された File 群から PMX/PMD を探して読み込み、SkinnedMesh を返す
  loadModel(files) {
    // 新しいモデルを読む前に、以前の Blob URL を解放する
    this._revokeAll();
    this.entries.clear();
    this.byName.clear();

    const keys = this.registerFiles(files);
    const modelKey = keys.find((k) => k.endsWith('.pmx')) || keys.find((k) => k.endsWith('.pmd'));
    if (!modelKey) {
      return Promise.reject(new Error('PMX/PMD ファイルが選択されていません'));
    }

    // テクスチャ相対パスの基準を PMX のあるフォルダにする
    const dir = modelKey.includes('/') ? modelKey.slice(0, modelKey.lastIndexOf('/') + 1) : '';
    this.loader.setResourcePath(VIRTUAL_PREFIX + dir);

    return new Promise((resolve, reject) => {
      this.loader.load(
        VIRTUAL_PREFIX + modelKey,
        (mesh) => resolve(mesh),
        undefined,
        (err) => reject(err instanceof Error ? err : new Error('モデルの読み込みに失敗しました'))
      );
    });
  }

  // VMD ファイル群を読み込み、mesh 用の AnimationClip を返す（複数はマージされる）
  loadAnimation(files, mesh) {
    const keys = this.registerFiles(files).filter((k) => k.endsWith('.vmd'));
    if (keys.length === 0) {
      return Promise.reject(new Error('VMD ファイルが選択されていません'));
    }
    const urls = keys.map((k) => VIRTUAL_PREFIX + k);
    return new Promise((resolve, reject) => {
      this.loader.loadAnimation(
        urls.length === 1 ? urls[0] : urls,
        mesh,
        (clip) => resolve(clip),
        undefined,
        (err) => reject(err instanceof Error ? err : new Error('モーションの読み込みに失敗しました'))
      );
    });
  }

  _revokeAll() {
    for (const url of this._objectUrls) URL.revokeObjectURL(url);
    this._objectUrls.length = 0;
  }
}
