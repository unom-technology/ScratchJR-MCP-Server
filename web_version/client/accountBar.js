// The student's button in the corner of every page: who is logged in, whether
// their work has reached the server, saving a project to the computer, loading
// one from it, and logging out. While an admin looks at a student's work it
// says whose work it is, and that nothing is saved.

import ScratchJr from '../../desktop/src/app/src/editor/ScratchJr.js';
import { goToLogin, stopViewing } from './webTablet.js';

const STATUS = {
  saved: 'All changes saved',
  saving: 'Saving...',
  offline: 'Can\'t reach the server. Your work is kept and will save when it\'s back.',
};

// A project file is a zip; anything bigger than this is not a ScratchJr project.
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text, onClick) {
  const node = element('button', 'sjr-web-item', text);
  node.type = 'button';
  node.onclick = onClick;
  return node;
}

export function startAccountBar() {
  window.addEventListener('sjr-ready', event => build(event.detail));
}

function build({user, viewing}) {
  const page = window.scratchJrPage || 'index';
  const inEditor = page === 'editor';

  const root = element('div', 'sjr-web-account');
  const pill = element('button', 'sjr-web-pill');
  pill.type = 'button';
  pill.title = 'Your account';
  const dot = element('span', 'sjr-web-dot saved');
  pill.append(dot, element('span', 'sjr-web-name', user.username));

  const menu = element('div', 'sjr-web-menu');
  menu.hidden = true;
  const heading = element('div', 'sjr-web-heading');
  heading.append('Logged in as ', element('strong', null, user.fullName || user.username));
  // A student's class, or "No section yet" until an admin gives them one.
  const details = [user.username];
  if (user.role === 'student' && user.grade) details.push(user.section ? `Grade ${user.section.grade} ${user.section.name}` : `Grade ${user.grade} · No section yet`);
  else if (user.role !== 'student') details.push(user.role === 'admin' ? 'Admin' : 'Teacher');
  const sub = element('div', 'sjr-web-sub', details.join(' · '));
  const status = element('div', 'sjr-web-status', STATUS.saved);

  if (viewing) {
    const name = viewing.fullName || viewing.username;
    root.classList.add('viewing');
    pill.title = `You are looking at ${name}'s projects. Nothing you change is saved.`;
    pill.replaceChildren(element('span', 'sjr-web-name', `Viewing ${name}`));
    heading.replaceChildren('Viewing ', element('strong', null, name), '\'s projects');
    sub.textContent = viewing.username;
    status.textContent = 'Look only: nothing you change here is saved, to them or to you.';
  }

  const exportButton = button('Save project to computer', () => {
    close();
    const handlers = window.tablet.projectFileHandlers;
    if (handlers) handlers.save();
  });
  if (!inEditor) {
    exportButton.disabled = true;
    exportButton.title = 'Open a project first';
  }

  const fileInput = element('input');
  fileInput.type = 'file';
  fileInput.accept = '.sjr';
  fileInput.hidden = true;
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) importFile(file);
  };
  const importButton = button('Load project from computer', () => {
    close();
    fileInput.click();
  });

  const logoutButton = button('Log out', () => logout());
  logoutButton.classList.add('sjr-web-logout');

  const staffPage = user.role === 'admin' ? 'Admin page' : 'Teacher page';
  menu.append(heading, sub, status, exportButton);
  if (viewing) {
    menu.append(button(`Back to ${staffPage.toLowerCase()}`, stopViewing));
  } else {
    menu.append(importButton);
    if (user.role !== 'student') {
      menu.append(button(staffPage, () => {
        window.location.href = '/admin';
      }));
    }
  }
  menu.append(logoutButton);
  const toast = element('div', 'sjr-web-toast');
  toast.hidden = true;
  root.append(toast, menu, pill, fileInput);
  document.body.appendChild(root);

  // The help book's tab bar is fixed along the bottom of the lobby, above this
  // button's layer; sit on top of it rather than underneath while it shows.
  const footer = document.getElementById('footer');
  if (footer) {
    const place = () => {
      root.style.bottom = getComputedStyle(footer).display === 'none' ? '' : `${footer.offsetHeight + 14}px`;
    };
    new MutationObserver(place).observe(footer, {attributes: true, attributeFilter: ['class', 'style']});
    window.addEventListener('resize', place);
    place();
  }

  function close() {
    menu.hidden = true;
  }
  pill.onclick = () => {
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('mousedown', event => {
    if (!root.contains(event.target)) close();
  });

  let toastTimer = null;
  function showToast(message, isError) {
    toast.textContent = message;
    toast.classList.toggle('error', Boolean(isError));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, isError ? 8000 : 4000);
  }

  window.addEventListener('sjr-save-state', event => {
    const {state, message} = event.detail;
    if (state === 'rejected') {
      showToast('Some work could not be saved: ' + message, true);
      return;
    }
    dot.className = 'sjr-web-dot ' + state;
    status.textContent = STATUS[state] || '';
    pill.title = STATUS[state] || '';
  });

  window.addEventListener('sjr-project-file', event => {
    const result = event.detail;
    if (result.error) showToast(result.error + (result.detail ? ` (${result.detail})` : ''), true);
    else if (result.action === 'save') showToast(`Saved ${result.fileName} to your Downloads folder.`);
    else if (result.action === 'load') showToast(`Loaded ${result.fileName || 'the project'}.`);
  });

  function importFile(file) {
    const handlers = window.tablet.projectFileHandlers;
    if (!handlers) return showToast('ScratchJr is still starting. Try again in a moment.', true);
    if (file.size > MAX_IMPORT_BYTES) return showToast('That file is too big to be a ScratchJr project.', true);
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result.split(',')[1] || '';
      // An .sjr is a zip archive, which always starts with "PK" (UEs in base64).
      if (!data.startsWith('UEs')) return showToast('That file is not a ScratchJr project.', true);
      handlers.load({fileName: file.name, data});
    };
    reader.onerror = () => showToast('That file could not be read.', true);
    reader.readAsDataURL(file);
  }

  async function logout() {
    close();
    logoutButton.disabled = true;
    // Whatever is on the screen in the editor is saved first.
    if (!viewing && inEditor && ScratchJr.stage && ScratchJr.stage.currentPage) {
      await new Promise(resolve => ScratchJr.saveProject(null, resolve));
    }
    const queue = window.tablet.queue;
    if (queue.size && !(await queue.flushInBackground())) {
      const leave = window.confirm('Some of your work has not reached the server yet. If you log out now, it will be saved the next time you log in on this computer.\n\nLog out anyway?');
      if (!leave) {
        logoutButton.disabled = false;
        return;
      }
    }
    try {
      await fetch('/api/logout', {method: 'POST', credentials: 'same-origin'});
    } catch (error) { /* the cookie is gone either way once it expires */ }
    try {
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith('sjr-web-')) window.sessionStorage.removeItem(key);
      }
    } catch (error) { /* storage blocked */ }
    goToLogin();
  }
}
