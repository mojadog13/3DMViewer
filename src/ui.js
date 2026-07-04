// 最小 UI の配線。DOM は index.html に置き、ここではイベント接続と
// 状態表示（active / disabled / ステータストースト）だけを担当する。

export function initUI(handlers) {
  const $ = (id) => document.getElementById(id);

  const modelInput = $('model-input');
  const folderInput = $('folder-input');
  const motionInput = $('motion-input');
  const folderBtn = $('folder-btn');
  const playBtn = $('play-btn');
  const gyroBtn = $('gyro-btn');
  const physicsBtn = $('physics-btn');
  const statusEl = $('status');

  let statusTimer = 0;

  modelInput.addEventListener('change', () => {
    if (modelInput.files.length > 0) handlers.onModelFiles([...modelInput.files]);
    modelInput.value = '';
  });

  folderInput.addEventListener('change', () => {
    if (folderInput.files.length > 0) handlers.onModelFiles([...folderInput.files]);
    folderInput.value = '';
  });

  motionInput.addEventListener('change', () => {
    if (motionInput.files.length > 0) handlers.onMotionFiles([...motionInput.files]);
    motionInput.value = '';
  });

  playBtn.addEventListener('click', () => handlers.onTogglePlay());
  gyroBtn.addEventListener('click', () => handlers.onToggleGyro());
  physicsBtn.addEventListener('click', () => handlers.onTogglePhysics());

  // フォルダ選択非対応の環境ではボタンを隠す
  if (!('webkitdirectory' in folderInput)) {
    folderBtn.style.display = 'none';
  }

  return {
    // sticky=true のメッセージは次のメッセージまで消えない（読込中表示用）
    setStatus(message, sticky = false) {
      clearTimeout(statusTimer);
      if (!message) {
        statusEl.style.display = 'none';
        return;
      }
      statusEl.textContent = message;
      statusEl.style.display = 'block';
      if (!sticky) {
        statusTimer = setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
      }
    },
    setPlaying(playing) {
      playBtn.textContent = playing ? '一時停止' : '再生';
    },
    setPlayEnabled(enabled) {
      playBtn.disabled = !enabled;
    },
    setGyroActive(active) {
      gyroBtn.classList.toggle('active', active);
    },
    setGyroEnabled(enabled) {
      gyroBtn.classList.toggle('disabled', !enabled);
    },
    setPhysicsActive(active) {
      physicsBtn.classList.toggle('active', active);
    },
    setPhysicsEnabled(enabled) {
      physicsBtn.classList.toggle('disabled', !enabled);
    },
  };
}
