const DB_NAME = 'holy-flow-db';
const DB_STORE = 'state';
const DB_KEY = 'main';
const LOCAL_FALLBACK_KEY = 'holy-flow-fallback';

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

let state = cloneDefault();
let selectedDate = toDateKey();
let db;

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
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holy-flow-backup-${toDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
});

$('#datePicker').addEventListener('change', async (event) => {
  selectedDate = event.target.value || toDateKey();
  await rerender();
});

$('#importInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    state = {
      ...cloneDefault(),
      ...parsed,
      routineByDate: parsed.routineByDate || {},
    };
    await rerender();
    alert('백업 복원이 완료되었습니다.');
  } catch {
    alert('올바른 백업 파일(JSON)이 아닙니다.');
  }
  event.target.value = '';
});

(async () => {
  await loadState();
  ensureRoutineForSelectedDate();
  await rerender();
})();
