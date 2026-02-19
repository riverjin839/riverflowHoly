const STORAGE_KEY = 'holy-flow-v1';

const defaultState = {
  qts: [],
  prayers: [],
  gratitudes: [],
  routine: {
    말씀읽기: false,
    기도: false,
    암송: false,
    예배: false,
    섬김: false,
    찬양: false,
  },
};

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
};

const save = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

const state = load();

const $ = (selector) => document.querySelector(selector);
const today = new Date().toLocaleDateString('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});
$('#todayLabel').textContent = today;

const renderStats = () => {
  const answered = state.prayers.filter((p) => p.answered).length;
  const routines = Object.values(state.routine);
  const done = routines.filter(Boolean).length;
  const rate = routines.length ? Math.round((done / routines.length) * 100) : 0;

  $('#stats').innerHTML = `
    <div class="stat"><p>누적 QT</p><strong>${state.qts.length}</strong></div>
    <div class="stat"><p>기도 응답</p><strong>${answered}</strong></div>
    <div class="stat"><p>감사 기록</p><strong>${state.gratitudes.length}</strong></div>
    <div class="stat"><p>루틴 완료율</p><strong>${rate}%</strong></div>
  `;
};

const renderPrayers = () => {
  $('#prayerList').innerHTML = state.prayers
    .map(
      (p) => `
      <li class="item">
        <div>
          <span class="badge">${p.category}</span>
          <span>${p.content}</span>
        </div>
        <label>
          <input type="checkbox" data-prayer-id="${p.id}" ${p.answered ? 'checked' : ''}/> 응답
        </label>
      </li>
    `,
    )
    .join('');
};

const renderGratitudes = () => {
  $('#gratitudeList').innerHTML = state.gratitudes
    .map(
      (g) => `
      <li class="item">
        <span>${g.text}</span>
        <span class="badge badge--ok">${g.date}</span>
      </li>
    `,
    )
    .join('');
};

const renderRoutine = () => {
  $('#routineList').innerHTML = Object.entries(state.routine)
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
  const history = [...state.qts].reverse().slice(0, 5);
  if (!history.length) {
    $('#qtHistory').innerHTML = '<p>아직 QT 기록이 없습니다. 오늘 첫 기록을 남겨보세요.</p>';
    return;
  }

  $('#qtHistory').innerHTML = history
    .map(
      (q) => `
      <article>
        <h4>${q.title}</h4>
        <p><strong>본문:</strong> ${q.scripture}</p>
        <p><strong>묵상:</strong> ${q.meditation}</p>
        <p><small>${q.date}</small></p>
      </article>
    `,
    )
    .join('');
};

const rerender = () => {
  renderStats();
  renderPrayers();
  renderGratitudes();
  renderRoutine();
  renderHistory();
  save(state);
};

$('#qtForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.qts.push({
    id: crypto.randomUUID(),
    scripture: data.get('scripture'),
    title: data.get('title'),
    meditation: data.get('meditation'),
    application: data.get('application'),
    prayer: data.get('prayer'),
    date: new Date().toLocaleString('ko-KR'),
  });
  event.currentTarget.reset();
  rerender();
});

$('#prayerForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.prayers.unshift({
    id: crypto.randomUUID(),
    content: data.get('content'),
    category: data.get('category'),
    answered: false,
  });
  event.currentTarget.reset();
  rerender();
});

$('#gratitudeForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.gratitudes.unshift({
    id: crypto.randomUUID(),
    text: data.get('text'),
    date: new Date().toLocaleDateString('ko-KR'),
  });
  state.gratitudes = state.gratitudes.slice(0, 21);
  event.currentTarget.reset();
  rerender();
});

document.body.addEventListener('change', (event) => {
  const prayerId = event.target.dataset.prayerId;
  const routineName = event.target.dataset.routine;

  if (prayerId) {
    const prayer = state.prayers.find((p) => p.id === prayerId);
    if (prayer) prayer.answered = event.target.checked;
  }

  if (routineName) {
    state.routine[routineName] = event.target.checked;
  }

  rerender();
});

rerender();
