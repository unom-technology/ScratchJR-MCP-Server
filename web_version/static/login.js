(function () {
  var mode = 'login';
  var form = document.getElementById('form');
  var username = document.getElementById('username');
  var password = document.getElementById('password');
  var confirm = document.getElementById('confirm');
  var confirmRow = document.getElementById('confirm-row');
  var submit = document.getElementById('submit');
  var error = document.getElementById('error');
  var notice = document.getElementById('notice');
  var hint = document.getElementById('hint');
  var tabs = {login: document.getElementById('tab-login'), register: document.getElementById('tab-register')};

  var reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'expired') {
    notice.textContent = 'You were logged out. Log in again to keep working; nothing you made is lost.';
    notice.hidden = false;
  }

  function setMode(next) {
    mode = next;
    Object.keys(tabs).forEach(function (key) {
      tabs[key].classList.toggle('on', key === mode);
      tabs[key].setAttribute('aria-selected', String(key === mode));
    });
    confirmRow.hidden = mode !== 'register';
    password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'register' ? 'Create my account' : 'Log in';
    hint.textContent = mode === 'register'
      ? 'Pick a username you will remember. Use letters and numbers.'
      : 'Forgot your password? Ask your teacher.';
    showError('');
    username.focus();
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  tabs.login.onclick = function () { setMode('login'); };
  tabs.register.onclick = function () { setMode('register'); };

  form.onsubmit = function (event) {
    event.preventDefault();
    showError('');
    if (!username.value.trim() || !password.value) return showError('Type your username and password.');
    if (mode === 'register' && password.value !== confirm.value) return showError('The two passwords are different. Type them again.');

    submit.disabled = true;
    fetch('/api/' + mode, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username.value, password: password.value})
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || 'Something went wrong. Try again.');
        window.location.href = '/app/home.html';
      });
    }).catch(function (problem) {
      showError(problem.message === 'Failed to fetch' ? 'The ScratchJr server could not be reached.' : problem.message);
      submit.disabled = false;
    });
  };

  // Already logged in on this browser: straight to the projects.
  fetch('/api/me', {credentials: 'same-origin'}).then(function (response) {
    if (response.ok) window.location.href = '/app/home.html';
  }).catch(function () {});

  username.focus();
})();
