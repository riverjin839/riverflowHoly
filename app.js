const DB_NAME = 'holy-flow-db';
const DB_STORE = 'state';
const DB_KEY = 'main';
const LOCAL_FALLBACK_KEY = 'holy-flow-fallback';
const SECURE_BACKUP_FORMAT = 'holy-flow-secure-backup';
const SECURE_BACKUP_VERSION = 1;
const SECURE_BACKUP_PBKDF2_ITERATIONS = 210000;

const defaultState = {
  qts: [],
  prayers: [],
  gratitudes: [],
  routineByDate: {},
};

const routines = ['말씀읽기', '기도', '암송', '예배', '섬김', '찬양'];

const toDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const fromDateKeyToLabel = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
};

const cloneDefault = () => JSON.parse(JSON.stringify(defaultState));
const $ = (selector) => document.querySelector(selector);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let state = cloneDefault();
let selectedDate = toDateKey();
let db;
let deferredPrompt;

const supportsSecureBackup = () => Boolean(window.crypto?.subtle && window.crypto?.getRandomValues);
const supportsCompression = () => typeof CompressionStream !== 'undefined';
const supportsDecompression = () => typeof DecompressionStream !== 'undefined';

const toBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const fromBase64 = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const compressBytes = async (bytes) => {
  if (!supportsCompression()) {
    return { bytes, compression: 'none' };
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressedBuffer = await new Response(stream).arrayBuffer();
  return { bytes: new Uint8Array(compressedBuffer), compression: 'gzip' };
};

const decompressBytes = async (bytes, compression) => {
  if (compression === 'none') return bytes;
  if (compression !== 'gzip') {
    throw new Error('지원하지 않는 백업 압축 형식입니다.');
  }
  if (!supportsDecompression()) {
    throw new Error('이 백업은 압축 형식(gzip)입니다. 최신 브라우저에서 복원해주세요.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressedBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
};

const deriveBackupKey = async (password, salt, iterations) => {
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const sanitizeImportedState = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('백업 형식이 올바르지 않습니다.');
  }

  return {
    ...cloneDefault(),
    ...parsed,
    qts: Array.isArray(parsed.qts) ? parsed.qts : [],
    prayers: Array.isArray(parsed.prayers) ? parsed.prayers : [],
    gratitudes: Array.isArray(parsed.gratitudes) ? parsed.gratitudes : [],
    routineByDate:
      parsed.routineByDate && typeof parsed.routineByDate === 'object' && !Array.isArray(parsed.routineByDate)
        ? parsed.routineByDate
        : {},
  };
};

const downloadFile = (content, filename, type = 'application/json') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const createSecureBackupText = async (data, password) => {
  const payload = {
    version: SECURE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state: data,
  };
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const compressed = await compressBytes(payloadBytes);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt, SECURE_BACKUP_PBKDF2_ITERATIONS);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed.bytes);

  return JSON.stringify(
    {
      format: SECURE_BACKUP_FORMAT,
      version: SECURE_BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      compression: compressed.compression,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: SECURE_BACKUP_PBKDF2_ITERATIONS,
        salt: toBase64(salt),
      },
      cipher: {
        name: 'AES-GCM',
        iv: toBase64(iv),
      },
      ciphertext: toBase64(new Uint8Array(cipherBuffer)),
    },
    null,
    2,
  );
};

const isSecureBackupEnvelope = (parsed) =>
  Boolean(parsed && typeof parsed === 'object' && parsed.format === SECURE_BACKUP_FORMAT);

const restoreSecureBackupState = async (envelope, password) => {
  if (!isSecureBackupEnvelope(envelope)) {
    throw new Error('보호 백업 파일 형식이 올바르지 않습니다.');
  }

  const iterations = Number(envelope?.kdf?.iterations);
  const saltValue = envelope?.kdf?.salt;
  const ivValue = envelope?.cipher?.iv;
  const ciphertextValue = envelope?.ciphertext;

  if (!iterations || !saltValue || !ivValue || !ciphertextValue) {
    throw new Error('보호 백업 파일 메타데이터가 누락되었습니다.');
  }

  try {
    const salt = fromBase64(saltValue);
    const iv = fromBase64(ivValue);
    const ciphertext = fromBase64(ciphertextValue);
    const key = await deriveBackupKey(password, salt, iterations);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const plainBytes = await decompressBytes(new Uint8Array(plainBuffer), envelope.compression || 'none');
    const payload = JSON.parse(textDecoder.decode(plainBytes));
    return sanitizeImportedState(payload?.state ?? payload);
  } catch {
    throw new Error('비밀번호가 올바르지 않거나 백업 파일이 손상되었습니다.');
  }
};

const openDB =
  window.indexedDB &&
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const saveFallback = (data) => localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(data));

const loadFallback = () => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY)) || cloneDefault();
  } catch {
    return cloneDefault();
  }
};

const loadState = async () => {
  if (!openDB) {
    state = loadFallback();
    return;
  }

  try {
    db = await openDB;
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    state = value || loadFallback() || cloneDefault();
  } catch {
    state = loadFallback();
  }
};

const persistState = async () => {
  saveFallback(state);
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).put(state, DB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }).catch(() => null);
};

const ensureRoutineForSelectedDate = () => {
  if (!state.routineByDate[selectedDate]) {
    state.routineByDate[selectedDate] = Object.fromEntries(routines.map((name) => [name, false]));
  }
};

const renderDateHeader = () => {
  $('#datePicker').value = selectedDate;
  $('#todayLabel').textContent = fromDateKeyToLabel(selectedDate);
};

const renderStats = () => {
  const answered = state.prayers.filter((p) => p.answered).length;
  const selectedRoutine = state.routineByDate[selectedDate] || {};
  const done = Object.values(selectedRoutine).filter(Boolean).length;
  const rate = routines.length ? Math.round((done / routines.length) * 100) : 0;

  $('#stats').innerHTML = `
    <div class="stat"><p>누적 QT</p><strong>${state.qts.length}</strong></div>
    <div class="stat"><p>기도 응답</p><strong>${answered}</strong></div>
    <div class="stat"><p>감사 기록</p><strong>${state.gratitudes.length}</strong></div>
    <div class="stat"><p>${selectedDate} 루틴</p><strong>${rate}%</strong></div>
  `;
};

const renderPrayers = () => {
  const prayers = state.prayers.filter((p) => p.dateKey === selectedDate);
  $('#prayerList').innerHTML = prayers
    .map(
      (p) => `
      <li class="item">
        <div>
          <span class="badge">${p.category}</span>
          <span>${p.content}</span>
        </div>
        <div class="actions">
          <label><input type="checkbox" data-prayer-check="${p.id}" ${p.answered ? 'checked' : ''}/>응답</label>
          <button type="button" data-prayer-edit="${p.id}">수정</button>
          <button type="button" class="danger" data-prayer-delete="${p.id}">삭제</button>
        </div>
      </li>
    `,
    )
    .join('');
};

const renderGratitudes = () => {
  const gratitudes = state.gratitudes.filter((g) => g.dateKey === selectedDate);
  $('#gratitudeList').innerHTML = gratitudes
    .map(
      (g) => `
      <li class="item">
        <span>${g.text}</span>
        <div class="actions">
          <button type="button" data-gratitude-edit="${g.id}">수정</button>
          <button type="button" class="danger" data-gratitude-delete="${g.id}">삭제</button>
          <span class="badge badge--ok">${g.dateKey}</span>
        </div>
      </li>
    `,
    )
    .join('');
};

const renderRoutine = () => {
  ensureRoutineForSelectedDate();
  const dateRoutine = state.routineByDate[selectedDate];
  $('#routineList').innerHTML = Object.entries(dateRoutine)
    .map(
      ([name, checked]) => `
      <label class="routine">
        <input type="checkbox" data-routine="${name}" ${checked ? 'checked' : ''}/>
        <span>${name}</span>
      </label>
    `,
    )
    .join('');
};

const renderHistory = () => {
  const history = state.qts.filter((q) => q.dateKey === selectedDate).reverse();
  if (!history.length) {
    $('#qtHistory').innerHTML = '<p>해당 날짜 QT 기록이 없습니다.</p>';
    return;
  }

  $('#qtHistory').innerHTML = history
    .map(
      (q) => `
      <article>
        <h4>${q.title}</h4>
        <p><strong>본문:</strong> ${q.scripture}</p>
        <p><strong>묵상:</strong> ${q.meditation}</p>
        <p><strong>적용:</strong> ${q.application || '-'}</p>
        <p><strong>기도:</strong> ${q.prayer}</p>
        <div class="actions">
          <button type="button" data-qt-edit="${q.id}">수정</button>
          <button type="button" class="danger" data-qt-delete="${q.id}">삭제</button>
          <span class="badge badge--ok">${q.dateKey}</span>
        </div>
      </article>
    `,
    )
    .join('');
};

const rerender = async () => {
  renderDateHeader();
  renderStats();
  renderPrayers();
  renderGratitudes();
  renderRoutine();
  renderHistory();
  await persistState();
};

const shiftDate = async (diff) => {
  const date = new Date(selectedDate);
  date.setDate(date.getDate() + diff);
  selectedDate = toDateKey(date);
  await rerender();
};

const findById = (array, id) => array.find((item) => item.id === id);

const registerInstallPrompt = () => {
  const installBtn = $('#installBtn');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });
};

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch {
    // ignore registration error
  }
};
$('#qtForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.qts.push({
    id: crypto.randomUUID(),
    scripture: data.get('scripture'),
    title: data.get('title'),
    meditation: data.get('meditation'),
    application: data.get('application'),
    prayer: data.get('prayer'),
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

$('#prayerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.prayers.unshift({
    id: crypto.randomUUID(),
    content: data.get('content'),
    category: data.get('category'),
    answered: false,
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

$('#gratitudeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.gratitudes.unshift({
    id: crypto.randomUUID(),
    text: data.get('text'),
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

document.body.addEventListener('change', async (event) => {
  const routineName = event.target.dataset.routine;
  const prayerCheck = event.target.dataset.prayerCheck;

  if (routineName) {
    ensureRoutineForSelectedDate();
    state.routineByDate[selectedDate][routineName] = event.target.checked;
    await rerender();
    return;
  }

  if (prayerCheck) {
    const prayer = findById(state.prayers, prayerCheck);
    if (prayer) prayer.answered = event.target.checked;
    await rerender();
  }
});

document.body.addEventListener('click', async (event) => {
  const id = event.target.dataset;

  if (id.qtDelete) {
    state.qts = state.qts.filter((q) => q.id !== id.qtDelete);
    await rerender();
  }

  if (id.qtEdit) {
    const target = findById(state.qts, id.qtEdit);
    if (!target) return;
    const title = prompt('QT 제목', target.title);
    const meditation = prompt('묵상', target.meditation);
    if (title && meditation) {
      target.title = title;
      target.meditation = meditation;
      await rerender();
    }
  }

  if (id.prayerDelete) {
    state.prayers = state.prayers.filter((p) => p.id !== id.prayerDelete);
    await rerender();
  }

  if (id.prayerEdit) {
    const target = findById(state.prayers, id.prayerEdit);
    if (!target) return;
    const content = prompt('기도제목 수정', target.content);
    if (content) {
      target.content = content;
      await rerender();
    }
  }

  if (id.gratitudeDelete) {
    state.gratitudes = state.gratitudes.filter((g) => g.id !== id.gratitudeDelete);
    await rerender();
  }

  if (id.gratitudeEdit) {
    const target = findById(state.gratitudes, id.gratitudeEdit);
    if (!target) return;
    const text = prompt('감사 수정', target.text);
    if (text) {
      target.text = text;
      await rerender();
    }
  }

  if (event.target.id === 'prevDateBtn') {
    await shiftDate(-1);
  }

  if (event.target.id === 'nextDateBtn') {
    await shiftDate(1);
  }

  if (event.target.id === 'exportBtn') {
    const backupMode = $('#backupModeSelect')?.value || 'json';

    if (backupMode === 'secure') {
      if (!supportsSecureBackup()) {
        alert('현재 브라우저는 보호 백업(암호화)을 지원하지 않습니다.');
        return;
      }

      const password = prompt('보호 백업 비밀번호를 입력하세요. (8자 이상 권장)');
      if (!password) return;
      if (password.length < 8) {
        alert('비밀번호는 8자 이상을 권장합니다.');
        return;
      }

      const confirmPassword = prompt('비밀번호를 한 번 더 입력하세요.');
      if (confirmPassword !== password) {
        alert('비밀번호가 일치하지 않습니다.');
        return;
      }

      try {
        const secureBackupText = await createSecureBackupText(state, password);
        downloadFile(secureBackupText, `holy-flow-backup-${toDateKey()}.hfbak`);
        if (!supportsCompression()) {
          alert('이 브라우저는 압축을 지원하지 않아 암호화만 적용된 백업으로 저장되었습니다.');
        }
      } catch {
        alert('보호 백업 파일 생성에 실패했습니다.');
      }
      return;
    }

    downloadFile(JSON.stringify(state, null, 2), `holy-flow-backup-${toDateKey()}.json`);
  }
});

$('#datePicker').addEventListener('change', async (event) => {
  selectedDate = event.target.value || toDateKey();
  await rerender();
});

$('#importInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (isSecureBackupEnvelope(parsed)) {
      if (!supportsSecureBackup()) {
        alert('현재 브라우저는 보호 백업 복원을 지원하지 않습니다.');
        return;
      }

      const password = prompt('보호 백업 복원 비밀번호를 입력하세요.');
      if (!password) return;
      state = await restoreSecureBackupState(parsed, password);
    } else {
      state = sanitizeImportedState(parsed);
    }

    await rerender();
    alert('백업 복원이 완료되었습니다.');
  } catch (error) {
    alert(error?.message || '올바른 백업 파일이 아닙니다.');
  } finally {
    event.target.value = '';
  }
});

(async () => {
  registerInstallPrompt();
  await registerServiceWorker();
  await loadState();
  ensureRoutineForSelectedDate();
  await rerender();
})();
