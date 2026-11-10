// The admin page, for teachers and admins.
//   Admins: every student's projects; every account (make, change, delete,
//   change role, new password); and the sections.
//   Teachers: the students in the sections they teach, their accounts and
//   their projects, to look at only. The server decides who sees whom
//   (server/access.js); this page only shows what it is given.
// Projects open in ScratchJr through the web tablet (?student= on the first
// page; see client/webTablet.js), which saves nothing while it does.
(() => {
  'use strict';

  const VIEWING_KEY = 'sjr-web-viewing';
  // Being here means this tab is no longer looking at a student, so the next
  // ScratchJr page it opens (My projects) shows one's own work.
  try { window.sessionStorage.removeItem(VIEWING_KEY); } catch { /* storage blocked */ }

  const $ = id => document.getElementById(id);
  const GRADES = Array.from({length: 12}, (_, i) => i + 1);
  const ROLE_LABEL = {student: 'Student', teacher: 'Teacher', admin: 'Admin'};

  const state = {
    me: null,
    sections: [],
    students: [], // the students this person may see
    accounts: [], // admins: every account
    selectedId: null,
    tab: 'projects',
    renamingSection: null,
  };
  const isAdmin = () => state.me && state.me.role === 'admin';

  // ---------------------------------------------------------------- helpers

  const stuck = () => new Promise(() => {});

  async function api(path, {method = 'GET', body} = {}) {
    let response;
    try {
      response = await fetch('/api' + path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('The ScratchJr server could not be reached.');
    }
    if (response.status === 401) {
      window.location.href = '/login?reason=expired';
      return stuck();
    }
    const data = await response.json().catch(() => ({}));
    // No longer a teacher or admin: this page has nothing for them.
    if (response.status === 403 && method === 'GET') {
      window.location.href = '/app/home.html';
      return stuck();
    }
    if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
    return data;
  }

  // An element with a class and children; strings become text, never HTML.
  function el(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  function button(text, className, onClick) {
    const node = el('button', 'btn ' + className, text);
    node.type = 'button';
    node.onclick = onClick;
    return node;
  }

  function option(value, text, selected) {
    const node = el('option', null, text);
    node.value = String(value);
    node.selected = Boolean(selected);
    return node;
  }

  const nameOf = person => person.fullName || person.username;
  const sectionLabel = section => `Grade ${section.grade} ${section.name}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function classLabel(student) {
    if (student.section) return sectionLabel(student.section);
    return student.grade ? `Grade ${student.grade} · no section yet` : 'No grade yet';
  }

  const relative = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'}) : null;
  const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

  function ago(iso) {
    if (!iso) return null;
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    if (!relative) return new Date(iso).toLocaleDateString();
    for (const [unit, size] of UNITS) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  }

  function showError(message) {
    $('error').textContent = message || '';
    $('error').hidden = !message;
  }

  let toastTimer = null;
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }

  // ---------------------------------------------------------------- loading

  async function loadAll() {
    const [sections, students, accounts] = await Promise.all([
      api('/admin/sections'),
      api('/admin/students'),
      isAdmin() ? api('/admin/accounts') : null,
    ]);
    state.sections = sections.sections;
    state.students = students.students;
    state.accounts = accounts ? accounts.accounts : [];
  }

  async function refresh() {
    $('refresh').disabled = true;
    try {
      await loadAll();
      showError('');
    } catch (error) {
      showError(error.message);
    }
    $('refresh').disabled = false;
    render();
  }

  function render() {
    renderFilters();
    renderStudents();
    renderAccounts();
    if (isAdmin()) renderSections();
  }

  // ---------------------------------------------------------------- tabs

  // #projects, #accounts, #sections, or #student=12 for one student's projects.
  function route() {
    const hash = window.location.hash.slice(1);
    const student = /^student=(\d+)$/.exec(hash);
    if (student) {
      const id = Number(student[1]);
      if (state.students.some(s => s.id === id) && id !== state.selectedId) select(id);
      showTab('projects');
    } else {
      showTab(hash === 'accounts' || (hash === 'sections' && isAdmin()) ? hash : 'projects');
    }
  }

  function showTab(tab) {
    state.tab = tab;
    for (const name of ['projects', 'accounts', 'sections']) {
      $('tab-' + name).hidden = tab !== name;
      document.querySelector(`[data-tab="${name}"]`).classList.toggle('on', tab === name);
    }
  }

  // ---------------------------------------------------------------- filters

  // Section choices: a teacher's own, or every section and "No section" for an admin.
  function fillSectionFilter(select, allText) {
    const current = select.value;
    select.replaceChildren(option('', allText));
    for (const section of state.sections) select.append(option(section.id, sectionLabel(section)));
    if (isAdmin()) select.append(option('none', 'No section'));
    select.value = [...select.options].some(o => o.value === current) ? current : '';
  }

  function renderFilters() {
    const all = isAdmin() ? 'All sections' : 'All my sections';
    fillSectionFilter($('projects-section'), all);
    fillSectionFilter($('accounts-section'), all);
    const grade = $('accounts-grade');
    if (!grade.options.length) {
      grade.append(option('', 'All grades'));
      for (const g of GRADES) grade.append(option(g, `Grade ${g}`));
    }
  }

  function inSection(person, value) {
    if (!value) return true;
    if (value === 'none') return person.role === 'student' && !person.section;
    const id = Number(value);
    return (person.section && person.section.id === id) || (person.teaching || []).some(s => s.id === id);
  }

  function inGrade(person, value) {
    if (!value) return true;
    const grade = Number(value);
    return person.grade === grade || (person.teaching || []).some(s => s.grade === grade);
  }

  function matches(person, query) {
    return !query || person.username.includes(query) || (person.fullName || '').toLowerCase().includes(query);
  }

  // ---------------------------------------------------------------- students' projects

  function lastActive(student) {
    return student.lastChangeAt || student.lastLoginAt || student.createdAt;
  }

  function renderStudents() {
    const query = $('search').value.trim().toLowerCase();
    const section = $('projects-section').value;
    const shown = state.students.filter(s => matches(s, query) && inSection({...s, role: 'student'}, section));
    if ($('sort').value === 'recent') shown.sort((a, b) => String(lastActive(b)).localeCompare(String(lastActive(a))));
    else shown.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    $('count').textContent = `(${state.students.length})`;
    const status = $('students-status');
    status.hidden = shown.length > 0;
    if (state.students.length) status.textContent = 'No student matches.';
    else if (isAdmin()) status.textContent = 'No students yet. They appear here once they make an account on the login page.';
    else if (!state.sections.length) status.textContent = 'You have no sections yet. An admin gives teachers the sections they teach.';
    else status.textContent = 'No students in your sections yet. An admin puts students in sections.';

    const list = $('student-list');
    list.replaceChildren();
    for (const student of shown) {
      const item = el('button', 'student' + (student.id === state.selectedId ? ' on' : ''),
        el('span', 'avatar', nameOf(student).charAt(0)),
        el('span', 'student-info',
          el('span', 'student-name', nameOf(student)),
          el('span', 'student-meta', `${classLabel(student)} · ${plural(student.projectCount, 'project')}`)));
      item.type = 'button';
      item.setAttribute('aria-current', String(student.id === state.selectedId));
      item.onclick = () => select(student.id);
      list.append(el('li', null, item));
    }
  }

  function select(id) {
    state.selectedId = id;
    // replaceState, not location.hash, so this does not count as a new visit.
    if (window.location.hash !== '#student=' + id) window.history.replaceState(null, '', '#student=' + id);
    renderStudents();
    loadStudent(id);
  }

  let loadingStudent = 0;
  async function loadStudent(id) {
    const ticket = ++loadingStudent;
    $('placeholder').hidden = true;
    $('student').hidden = false;
    const known = state.students.find(s => s.id === id);
    $('student-name').textContent = known ? nameOf(known) : '';
    $('student-meta').textContent = '';
    $('projects').replaceChildren();
    $('projects-status').textContent = 'Loading projects...';
    $('projects-status').hidden = false;
    try {
      const body = await api('/admin/students/' + id);
      if (ticket === loadingStudent) renderStudent(body.student, body.projects);
    } catch (error) {
      if (ticket === loadingStudent) $('projects-status').textContent = error.message;
    }
  }

  function renderStudent(student, projects) {
    $('student-name').textContent = nameOf(student);
    const joined = new Date(student.createdAt).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
    const login = ago(student.lastLoginAt);
    $('student-meta').textContent = [student.username, classLabel(student), 'joined ' + joined, login ? 'last logged in ' + login : 'never logged in'].join(' · ');
    $('open-lobby').href = '/app/home.html?student=' + student.id;

    const status = $('projects-status');
    status.hidden = projects.length > 0;
    status.textContent = 'No projects yet.';

    const grid = $('projects');
    grid.replaceChildren();
    for (const project of projects) {
      const card = el('a', 'project');
      card.href = `/app/editor.html?pmd5=${project.id}&mode=edit&student=${student.id}`;
      card.title = `Open "${project.name || 'Untitled'}" in ScratchJr`;

      const thumb = el('span', 'thumb');
      if (project.thumbnail) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = `/api/admin/students/${student.id}/thumbnails/${encodeURIComponent(project.thumbnail)}`;
        img.onerror = () => {
          img.remove();
          thumb.classList.add('missing');
        };
        thumb.append(img);
      } else {
        thumb.classList.add('missing');
      }

      let meta = 'Changed ' + ago(project.changedAt);
      if (project.pages) meta += ' · ' + plural(project.pages, 'page');
      const when = el('span', 'project-meta', meta);
      when.title = new Date(project.changedAt).toLocaleString();

      card.append(thumb, el('span', 'project-name', project.name || 'Untitled'), when);
      if (project.isGift) {
        const badge = el('span', 'badge', 'Loaded from a file');
        badge.title = 'The student added this from an .sjr file rather than starting it here.';
        card.append(badge);
      }
      grid.append(card);
    }
  }

  // ---------------------------------------------------------------- accounts

  function renderAccounts() {
    const admin = isAdmin();
    const source = admin ? state.accounts : state.students.map(s => ({...s, role: 'student'}));
    const query = $('accounts-search').value.trim().toLowerCase();
    const role = admin ? $('accounts-role').value : '';
    const grade = $('accounts-grade').value;
    const section = $('accounts-section').value;
    const shown = source
      .filter(a => matches(a, query) && (!role || a.role === role) && inGrade(a, grade) && inSection(a, section))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    const body = $('accounts-body');
    body.replaceChildren();
    for (const account of shown) {
      const self = account.id === state.me.id;
      let classCell;
      if (account.role === 'student') {
        classCell = el('span', account.section ? null : 'cell-none', classLabel(account));
      } else if (account.role === 'teacher') {
        classCell = account.teaching.length
          ? el('div', 'chips', ...account.teaching.map(s => el('span', 'chip', sectionLabel(s))))
          : el('span', 'cell-none', 'No sections yet');
      } else {
        classCell = el('span', 'cell-none', 'Sees every section');
      }

      const actions = el('div', 'actions');
      if (account.role === 'student') {
        actions.append(button('Projects', 'small', () => {
          showTab('projects');
          select(account.id);
          window.scrollTo(0, 0);
        }));
      }
      if (admin) {
        actions.append(button('Edit', 'small', () => openAccountDialog(account)));
        if (!self) actions.append(button('Delete', 'small link-danger', () => confirmDeleteAccount(account)));
      }

      body.append(el('tr', null,
        el('td', null, el('div', 'cell-name', nameOf(account)), el('div', 'cell-sub', account.username + (self ? ' (you)' : ''))),
        el('td', null, el('span', 'role role-' + account.role, ROLE_LABEL[account.role] || account.role)),
        el('td', null, classCell),
        el('td', null, String(account.projectCount)),
        el('td', null, ago(account.lastLoginAt) || el('span', 'cell-none', 'Never')),
        el('td', null, actions)));
    }

    const status = $('accounts-status');
    status.hidden = shown.length > 0;
    status.textContent = source.length ? 'No account matches.' : admin ? 'No accounts yet.' : 'No students in your sections yet.';
  }

  function confirmDeleteAccount(account) {
    const projects = account.projectCount ? ` Their ${plural(account.projectCount, 'project')} will be deleted too.` : '';
    confirmAction({
      title: `Delete ${nameOf(account)}?`,
      message: `The account ${account.username} can't log in any more.${projects} This can't be undone.`,
      run: async () => {
        await api('/admin/accounts/' + account.id, {method: 'DELETE'});
        if (state.selectedId === account.id) {
          state.selectedId = null;
          $('student').hidden = true;
          $('placeholder').hidden = false;
        }
        toast(`Deleted ${nameOf(account)}.`);
      },
    });
  }

  // ---------------------------------------------------------------- the account form

  let editing = null; // the account being changed, or null for a new one

  function fillGradeSelect(select, grade) {
    select.replaceChildren(option('', 'Pick a grade'), ...GRADES.map(g => option(g, `Grade ${g}`, g === grade)));
  }

  function fillSectionSelect(grade, sectionId) {
    const select = $('account-section');
    const choices = state.sections.filter(s => s.grade === grade);
    select.replaceChildren(option('', grade ? 'No section yet' : 'Pick a grade first'),
      ...choices.map(s => option(s.id, s.name, s.id === sectionId)));
    select.disabled = !grade || !choices.length;
    if (grade && !choices.length) select.options[0].textContent = `No Grade ${grade} sections yet`;
  }

  function fillTeaching(selectedIds) {
    const list = $('teaching-list');
    list.replaceChildren();
    if (!state.sections.length) {
      list.append(el('p', 'field-note', 'There are no sections yet. Add them on the Sections tab first.'));
      return;
    }
    for (const grade of GRADES) {
      const sections = state.sections.filter(s => s.grade === grade);
      if (!sections.length) continue;
      const line = el('div', 'grade-line', el('strong', null, `Grade ${grade}`));
      for (const section of sections) {
        const box = el('input');
        box.type = 'checkbox';
        box.name = 'teaching';
        box.value = String(section.id);
        box.checked = selectedIds.includes(section.id);
        line.append(el('label', 'check', box, section.name));
      }
      list.append(line);
    }
  }

  function showRoleFields(role) {
    $('student-fields').hidden = role !== 'student';
    $('teacher-fields').hidden = role !== 'teacher';
    $('admin-note').hidden = role !== 'admin';
  }

  function openAccountDialog(account) {
    editing = account || null;
    const form = $('account-form');
    form.reset();
    const self = Boolean(account) && account.id === state.me.id;
    $('account-title').textContent = account ? `Edit ${nameOf(account)}` : 'New account';
    $('self-note').hidden = !self;
    const role = account ? account.role : 'student';
    for (const radio of form.elements.role) {
      radio.checked = radio.value === role;
      radio.disabled = self;
    }
    showRoleFields(role);
    form.elements.fullName.value = account ? account.fullName || '' : '';
    form.elements.username.value = account ? account.username : '';
    $('password-label').textContent = account ? 'New password' : 'Password';
    $('password-note').textContent = account
      ? 'Leave empty to keep their password. A new one logs them out everywhere.'
      : 'At least 4 characters. Tell them this, so they can log in.';
    const grade = account && account.role === 'student' ? account.grade : null;
    fillGradeSelect($('account-grade'), grade);
    fillSectionSelect(grade, account && account.section ? account.section.id : null);
    fillTeaching(account && account.teaching ? account.teaching.map(s => s.id) : []);
    $('account-error').hidden = true;
    $('account-save').disabled = false;
    $('account-dialog').showModal();
    form.elements.fullName.focus();
  }

  $('account-form').addEventListener('change', event => {
    if (event.target.name === 'role') showRoleFields(event.target.value);
    if (event.target.name === 'grade') fillSectionSelect(Number(event.target.value) || null, null);
  });

  $('account-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.target.elements;
    const role = [...form.role].find(r => r.checked).value;
    const body = {fullName: form.fullName.value, username: form.username.value, role};
    if (!editing || form.password.value) body.password = form.password.value;
    if (role === 'student') {
      body.grade = form.grade.value ? Number(form.grade.value) : null;
      body.sectionId = form.section.value ? Number(form.section.value) : null;
    }
    if (role === 'teacher') body.teachingIds = [...document.querySelectorAll('#teaching-list input:checked')].map(box => Number(box.value));
    if (editing && editing.id === state.me.id) delete body.role;

    $('account-save').disabled = true;
    $('account-error').hidden = true;
    try {
      if (editing) await api('/admin/accounts/' + editing.id, {method: 'PATCH', body});
      else await api('/admin/accounts', {method: 'POST', body});
      $('account-dialog').close();
      toast(editing ? `Saved ${body.fullName.trim() || body.username}.` : `Made the account ${body.username.trim().toLowerCase()}.`);
      if (editing && editing.id === state.me.id) await loadMe();
      await refresh();
    } catch (error) {
      $('account-error').textContent = error.message;
      $('account-error').hidden = false;
      $('account-save').disabled = false;
    }
  };

  $('account-cancel').onclick = () => $('account-dialog').close();
  $('new-account').onclick = () => openAccountDialog(null);

  // ---------------------------------------------------------------- sections

  function renderSections() {
    const list = $('sections-list');
    list.replaceChildren();
    if (!state.sections.length) {
      list.append(el('p', 'muted', 'No sections yet. Add each class your school has, such as Grade 4 Trust.'));
      return;
    }
    for (const grade of GRADES) {
      const sections = state.sections.filter(s => s.grade === grade);
      if (!sections.length) continue;
      const group = el('div', 'grade-group', el('h3', null, `Grade ${grade}`));
      for (const section of sections) group.append(sectionRow(section));
      list.append(group);
    }
  }

  function sectionRow(section) {
    const teachers = section.teachers.length ? 'Teachers: ' + section.teachers.map(nameOf).join(', ') : 'No teacher yet';
    const meta = el('span', 'section-meta', `${plural(section.studentCount, 'student')} · ${teachers}`);

    if (state.renamingSection === section.id) {
      const input = el('input');
      input.value = section.name;
      input.maxLength = 40;
      input.setAttribute('aria-label', 'New name');
      const save = async () => {
        try {
          await api('/admin/sections/' + section.id, {method: 'PATCH', body: {name: input.value}});
          state.renamingSection = null;
          toast('Renamed the section.');
          await refresh();
        } catch (error) {
          showError(error.message);
        }
      };
      input.onkeydown = event => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') {
          state.renamingSection = null;
          renderSections();
        }
      };
      setTimeout(() => input.focus(), 0);
      return el('div', 'section-row', input, meta,
        button('Save', 'small', save),
        button('Cancel', 'small', () => {
          state.renamingSection = null;
          renderSections();
        }));
    }

    return el('div', 'section-row', el('span', 'section-name', section.name), meta,
      button('Rename', 'small', () => {
        state.renamingSection = section.id;
        renderSections();
      }),
      button('Delete', 'small link-danger', () => confirmAction({
        title: `Delete ${sectionLabel(section)}?`,
        message: section.studentCount
          ? `Its ${plural(section.studentCount, 'student')} will have no section until you give them one, and its teachers will no longer see them. Nobody's projects are deleted.`
          : 'It has no students. Its teachers will no longer have it.',
        run: async () => {
          await api('/admin/sections/' + section.id, {method: 'DELETE'});
          toast(`Deleted ${sectionLabel(section)}.`);
        },
      })));
  }

  $('section-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.target.elements;
    $('section-error').hidden = true;
    try {
      const {section} = await api('/admin/sections', {method: 'POST', body: {grade: Number(form.grade.value), name: form.name.value}});
      form.name.value = '';
      toast(`Added ${sectionLabel(section)}.`);
      await refresh();
      form.name.focus();
    } catch (error) {
      $('section-error').textContent = error.message;
      $('section-error').hidden = false;
    }
  };

  // ---------------------------------------------------------------- confirming

  let pending = null;
  function confirmAction({title, message, run}) {
    pending = run;
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-error').hidden = true;
    $('confirm-go').disabled = false;
    $('confirm-dialog').showModal();
  }

  $('confirm-go').onclick = async () => {
    $('confirm-go').disabled = true;
    try {
      await pending();
      $('confirm-dialog').close();
      await refresh();
    } catch (error) {
      $('confirm-error').textContent = error.message;
      $('confirm-error').hidden = false;
      $('confirm-go').disabled = false;
    }
  };
  $('confirm-cancel').onclick = () => $('confirm-dialog').close();

  // ---------------------------------------------------------------- start

  async function loadMe() {
    state.me = await api('/me');
    $('me').textContent = nameOf(state.me);
  }

  for (const id of ['search', 'sort', 'projects-section']) $(id).addEventListener('input', renderStudents);
  for (const id of ['accounts-search', 'accounts-role', 'accounts-grade', 'accounts-section']) $(id).addEventListener('input', renderAccounts);
  $('refresh').onclick = async () => {
    await refresh();
    if (state.selectedId) loadStudent(state.selectedId);
  };
  window.addEventListener('hashchange', route);

  $('logout').onclick = async () => {
    $('logout').disabled = true;
    try { await fetch('/api/logout', {method: 'POST', credentials: 'same-origin'}); } catch { /* gone when it expires */ }
    try {
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith('sjr-web-')) window.sessionStorage.removeItem(key);
      }
    } catch { /* storage blocked */ }
    window.location.href = '/login';
  };

  (async () => {
    try {
      await loadMe();
    } catch (error) {
      showError(error.message);
      return;
    }
    if (state.me.role === 'student') {
      window.location.href = '/app/home.html';
      return;
    }
    const admin = isAdmin();
    document.title = admin ? 'ScratchJr - Admin' : 'ScratchJr - Teacher';
    $('role-tag').textContent = admin ? 'Admin' : 'Teacher';
    $('role-tag').classList.toggle('teacher', !admin);
    document.querySelector('[data-tab="sections"]').hidden = !admin;
    $('new-account').hidden = !admin;
    $('accounts-role').hidden = !admin;
    fillGradeSelect($('section-grade'), null);
    $('section-grade').options[0].textContent = 'Grade';
    if (admin) {
      $('accounts-hint').textContent = 'Every account. Make teacher and admin accounts here; students can also sign up themselves.';
    } else {
      $('placeholder-text').textContent = 'Pick a student from your sections to see their projects. Open one to look at it in ScratchJr, exactly as they left it.';
    }
    await refresh();
    if (!admin) {
      $('accounts-hint').textContent = state.sections.length
        ? `The students in your sections: ${state.sections.map(sectionLabel).join(', ')}. Only an admin can change accounts.`
        : 'You have no sections yet. An admin gives teachers the sections they teach.';
    }
    route();
  })();
})();
