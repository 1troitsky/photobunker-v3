/* Fieldwork 4.2 — standalone interactive DEMO, not production domain logic. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const device = document.getElementById('device');
  const list = document.getElementById('task-list');
  const overlay = document.getElementById('dialog-overlay');
  const dialog = overlay.querySelector('.dialog-sheet');
  const heading = document.getElementById('dialog-title');
  const dialogContent = document.getElementById('dialog-content');
  const searchBox = document.querySelector('.search-box');
  const searchInput = document.getElementById('task-search');
  const statusLed = document.querySelector('.state-led');
  const statusLabel = document.getElementById('state-label');

  const icons = {
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M14 7h2M9 11h2M14 11h2M9 15h2M14 15h2M10 21v-4h4v4"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M11 10v11"/>',
    waves: '<path d="M2 9c3-4 5 4 8 0s5-4 8 0 4 0 4 0M2 16c3-4 5 4 8 0s5-4 8 0 4 0 4 0"/>',
    tool: '<path d="M14 7a5 5 0 0 0-7 7l-5 5 3 3 5-5a5 5 0 0 0 7-7l-4 4-3-3z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 4"/>',
    camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="4"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h8v13H3z"/>'
  };
  const svg = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.building) + '</svg>';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
  const dateText = iso => iso
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso + 'T12:00:00Z'))
    : 'Без срока';
  const daysBetween = (a, b) => Math.round(
    (Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000
  );
  function durationText(a, b) {
    if (!a || !b) return 'Без срока';
    const days = daysBetween(a, b);
    if (days < 0) return '—';
    const first = new Date(a + 'T12:00:00Z');
    const last = new Date(b + 'T12:00:00Z');
    const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 +
      last.getUTCMonth() - first.getUTCMonth();
    if (months >= 2 && last.getUTCDate() === first.getUTCDate()) return months + ' мес.';
    if (days >= 14 && days % 7 === 0) return (days / 7) + ' нед.';
    return days + ' дн.';
  }

  // Synthetic data only. Actual PhotoBunker rows come from localTasks,
  // collaboration/workspace snapshots and confirmed ciphertext receipts.
  const tasks = [
    { id: 'A-014', name: 'Фасады — Site A', description: 'Снять фасад здания с разных ракурсов, включая детали входной группы.', start: '2026-11-05', end: '2026-11-20', photos: 12, target: 30, participants: 4, team: 'Site A Crew', icon: 'building', tone: '', done: false, planned: false, created: 4, canCapture: true, canBrowse: true, canManage: true },
    { id: 'A-018', name: 'Интерьер — зал 02', description: 'Общий план, освещение и архитектурные элементы.', start: '2026-11-07', end: '', photos: 8, target: null, participants: 2, team: 'Интерьеры', icon: 'layout', tone: 'blue', done: false, planned: false, created: 3, canCapture: true, canBrowse: true, canManage: true },
    { id: 'A-021', name: 'Побережье — репортаж', description: 'Съёмка береговой линии, включая утренние и вечерние кадры.', start: '2026-11-14', end: '2026-11-28', photos: 0, target: 24, participants: 3, team: 'Репортаж', icon: 'waves', tone: 'amber', done: false, planned: true, created: 2, canCapture: true, canBrowse: true, canManage: true },
    { id: 'A-003', name: 'Контроль оборудования', description: 'Зафиксировать результаты проверки оборудования.', start: '2026-10-26', end: '2026-10-30', photos: 15, target: 15, participants: 1, team: '', icon: 'tool', tone: 'gray', done: true, planned: false, created: 1, canCapture: false, canBrowse: true, canManage: true }
  ];
  const state = { tab: 'active', query: '', sort: 'created', dialog: '', selected: null, lastFocus: null };
  const find = id => tasks.find(task => task.id === id);

  function taskCard(task) {
    const percent = task.target ? Math.min(100, Math.round(task.photos / task.target * 100)) : null;
    const label = task.done ? 'Завершено' : task.planned ? 'Запланировано' : 'В работе';
    const stateClass = task.done ? 'done' : task.planned ? 'planned' : '';
    const canCapture = task.canCapture && !task.done;
    const canOpenBrowser = task.canBrowse && task.photos > 0;
    return '<article class="task-card">' +
      '<div class="task-card-top">' +
        '<span class="task-avatar ' + escapeHtml(task.tone) + '">' + svg(task.icon) + '</span>' +
        '<button type="button" class="task-title" data-action="details" data-id="' + escapeHtml(task.id) + '">' +
          '<strong>' + escapeHtml(task.name) + '</strong>' +
          '<span class="task-subline">' +
            '<span class="task-state ' + stateClass + '">' + label + '</span>' +
            '<span class="task-members">' + svg('users') + ' ' + task.participants + '</span>' +
            (task.team ? '<span class="task-team">' + escapeHtml(task.team) + '</span>' : '') +
          '</span>' +
        '</button>' +
        '<button type="button" class="task-more" data-action="menu" data-id="' + escapeHtml(task.id) + '" aria-label="Действия: ' + escapeHtml(task.name) + '">•••</button>' +
      '</div>' +
      '<p class="task-description">' + escapeHtml(task.description) + '</p>' +
      '<div class="task-dates">' +
        '<div><small>Начало</small><strong>' + dateText(task.start) + '</strong></div>' +
        '<div><small>Окончание</small><strong>' + dateText(task.end) + '</strong></div>' +
        '<div><small>Длительность</small><strong>' + durationText(task.start, task.end) + '</strong></div>' +
      '</div>' +
      '<div class="task-progress"><strong>' + task.photos + ' <span>' +
        (task.target ? '/ ' + task.target : 'фото') + '</span></strong>' +
        (percent !== null ? '<b>' + percent + '%</b>' : '') +
      '</div>' +
      (percent !== null ? '<div class="task-track"><i style="width:' + percent + '%"></i></div>' : '') +
      ((canCapture || canOpenBrowser) ? '<div class="task-actions">' +
        (canCapture ? '<button type="button" class="primary" data-action="capture" data-id="' + escapeHtml(task.id) + '">' + svg('camera') + 'Снимать</button>' : '') +
        (canOpenBrowser ? '<button type="button" data-action="browse" data-id="' + escapeHtml(task.id) + '">' + svg('folder') + 'Browser</button>' : '') +
      '</div>' : '') +
    '</article>';
  }

  function renderList() {
    document.getElementById('total-count').textContent = tasks.length;
    document.getElementById('active-count').textContent = tasks.filter(task => !task.done).length;
    document.getElementById('done-count').textContent = tasks.filter(task => task.done).length;
    document.querySelectorAll('[data-tab]').forEach(button => {
      const selected = button.dataset.tab === state.tab;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    const rows = tasks.filter(task =>
      (state.tab === 'all' || (state.tab === 'archive' ? task.done : !task.done)) &&
      (task.name + ' ' + task.description + ' ' + task.team).toLowerCase().includes(state.query.toLowerCase())
    ).sort((a, b) => state.sort === 'photos' ? b.photos - a.photos : b.created - a.created);
    list.innerHTML = rows.length ? rows.map(taskCard).join('') :
      '<div class="empty-state">Задания не найдены</div>';
  }

  function action(name, label, id, dangerous = false) {
    return '<button type="button" data-action="' + name + '" data-id="' + escapeHtml(id ?? '') +
      '"' + (dangerous ? ' class="danger"' : '') + '>' + label + '</button>';
  }

  function openDialog(kind, id = '') {
    state.lastFocus = document.activeElement;
    state.dialog = kind;
    state.selected = id;
    const task = find(id);
    let html = '';
    let title = '';
    if (kind === 'status') {
      title = 'Состояние PhotoBunker';
      html = '<div class="dialog-note">Это демонстрация состояний. В приложении индикатор показывает реальные операции и ошибки. Нормальное состояние не должно создавать лишних уведомлений.</div>' +
        ['В работе', 'Загрузка', 'Подключение', 'Офлайн', 'Ошибка', 'Готово'].map(label => action('set-status', label, label)).join('');
    } else if (kind === 'settings') {
      title = 'Настройки заданий';
      html = '<label>Сортировка<select id="sort-select"><option value="created">Дата создания</option><option value="photos">Количество фото</option></select></label>' +
        '<button type="button" class="submit" data-action="apply-sort">Применить</button>';
    } else if (kind === 'menu' && task) {
      title = task.name;
      html = action('details', 'Открыть задание', id) +
        (task.canManage ? action('edit', 'Редактировать', id) : '') +
        action('duplicate', 'Дублировать', id) +
        (task.canManage ? action('toggle', task.done ? 'Возобновить' : 'Завершить', id) +
        action('delete', 'Удалить', id, true) : '');
    } else if (kind === 'create' || (kind === 'edit' && task)) {
      title = kind === 'create' ? 'Новое задание' : 'Редактировать';
      html = '<label>Название<input id="form-name" maxlength="100" value="' + escapeHtml(kind === 'edit' ? task.name : '') + '"></label>' +
        '<label>Инструкции<textarea id="form-description">' + escapeHtml(kind === 'edit' ? task.description : '') + '</textarea></label>' +
        '<label>Нужно фото (необязательно)<input id="form-target" type="number" min="1" max="9999" value="' + (kind === 'edit' && task.target ? task.target : '') + '"></label>' +
        '<label>Участники — демонстрационное количество<input id="form-participants" type="number" min="1" max="100" value="' + (kind === 'edit' ? task.participants : 1) + '"></label>' +
        '<label>Команда<input id="form-team" value="' + escapeHtml(kind === 'edit' ? task.team : '') + '"></label>' +
        '<div class="dialog-note">Макет редактора показывает только часть полей. Production-редактор также содержит сроки, пресеты, выбор участников и правила. Здесь ничего не отправляется на сервер.</div>' +
        '<button type="button" class="submit" data-action="save">Сохранить</button>';
    } else if (kind === 'details' && task) {
      title = task.name;
      html = '<div class="dialog-note">' + escapeHtml(task.description) + '<p>' +
        task.photos + (task.target ? ' / ' + task.target : '') + ' фото · ' +
        task.participants + ' участников · ' + escapeHtml(task.team || 'Без команды') +
        '</p><p>В существующей карточке: Фото / Требования / Участники.</p></div>' +
        (task.canCapture && !task.done ? action('capture', 'Снимать', id) : '') +
        (task.canBrowse && task.photos > 0 ? action('browse', 'Открыть Browser', id) : '');
    } else if (kind === 'capture' || kind === 'browse' || kind === 'nav') {
      title = kind === 'capture' ? 'Камера' : kind === 'browse' ? 'Browser' : id;
      html = '<div class="dialog-note">Это только UX-прототип. В приложении здесь произойдёт переход на настоящий экран с сохранением контекста задания. В этом макете переход не выполняется.</div>';
    } else return;

    heading.textContent = title;
    dialogContent.innerHTML = html;
    if (kind === 'settings') document.getElementById('sort-select').value = state.sort;
    overlay.hidden = false;
    dialog.focus();
  }

  function closeDialog() {
    overlay.hidden = true;
    state.dialog = '';
    if (state.lastFocus && state.lastFocus.isConnected) state.lastFocus.focus();
    state.lastFocus = null;
  }

  const statusClasses = {
    'В работе': '', 'Загрузка': 'busy', 'Подключение': 'busy',
    'Офлайн': 'warning', 'Ошибка': 'error', 'Готово': ''
  };
  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !app.contains(button)) return;

    const tab = button.dataset.tab;
    const nav = button.dataset.nav;
    const name = button.dataset.action;
    const id = button.dataset.id;
    const task = find(id);
    if (tab) { state.tab = tab; renderList(); return; }
    if (nav) { if (nav !== 'Задания') openDialog('nav', nav); return; }
    if (!name) return;

    if (name === 'search') {
      searchBox.hidden = !searchBox.hidden;
      if (!searchBox.hidden) searchInput.focus();
      else { state.query = ''; searchInput.value = ''; renderList(); }
    } else if (['status', 'settings', 'create', 'menu', 'details', 'edit', 'capture', 'browse'].includes(name)) {
      openDialog(name, id);
    } else if (name === 'close') {
      closeDialog();
    } else if (name === 'set-status') {
      statusLabel.textContent = id;
      statusLed.className = 'state-led ' + statusClasses[id];
      closeDialog();
    } else if (name === 'apply-sort') {
      state.sort = document.getElementById('sort-select').value;
      closeDialog();
      renderList();
    } else if (name === 'toggle' && task && task.canManage) {
      task.done = !task.done;
      closeDialog();
      renderList();
    } else if (name === 'duplicate' && task) {
      tasks.unshift({ ...task, id: 'L-' + Date.now(), name: task.name + ' — копия', photos: 0,
        done: false, planned: false, created: Date.now() });
      state.tab = 'active';
      closeDialog();
      renderList();
    } else if (name === 'delete' && task && task.canManage) {
      if (window.confirm('Удалить задание из ДЕМОНСТРАЦИОННОГО списка?')) {
        tasks.splice(tasks.indexOf(task), 1);
        closeDialog();
        renderList();
      }
    } else if (name === 'save') {
      const title = document.getElementById('form-name').value.trim();
      if (!title) { document.getElementById('form-name').focus(); return; }
      const target = Number(document.getElementById('form-target').value) || null;
      const update = {
        name: title, description: document.getElementById('form-description').value,
        target: target && Math.min(9999, Math.max(1, target)),
        participants: Math.max(1, Math.min(100, Number(document.getElementById('form-participants').value) || 1)),
        team: document.getElementById('form-team').value
      };
      const editedTask = find(state.selected);
      if (state.dialog === 'edit' && editedTask) {
        Object.assign(editedTask, update);
      } else {
        tasks.unshift({ ...update, id: 'L-' + Date.now(), start: '2026-11-07', end: '',
          photos: 0, icon: 'building', tone: 'gray', done: false,
          planned: false, created: Date.now(), canCapture: true,
          canBrowse: true, canManage: true });
      }
      state.tab = 'active';
      closeDialog();
      renderList();
    }
  });
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderList();
  });
  document.querySelectorAll('[data-device]').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.device;
      device.className = 'device ' + mode;
      document.querySelectorAll('[data-device]').forEach(other => {
        const active = other === button;
        other.classList.toggle('selected', active);
        other.setAttribute('aria-pressed', String(active));
      });
    });
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeDialog();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) { event.preventDefault(); closeDialog(); }
  });
  renderList();
})();
