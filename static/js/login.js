'use strict';
const tabs = [...document.querySelectorAll('.tab')];
const panels = {
  login: document.getElementById('loginForm'),
  cadastro: document.getElementById('cadastroForm')
};

function showTab(name) {
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  Object.entries(panels).forEach(([k, p]) => p.classList.toggle('active', k === name));
}

tabs.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

function maskTelefoneFixoBR(value) {
  const digitos = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos.length ? '(' + digitos : '';
  if (digitos.length <= 7) return '(' + digitos.slice(0, 2) + ') ' + digitos.slice(2);
  return '(' + digitos.slice(0, 2) + ') ' + digitos.slice(2, 7) + '-' + digitos.slice(7);
}

const cadTelefone = document.getElementById('cadTelefone');
cadTelefone.addEventListener('input', () => { cadTelefone.value = maskTelefoneFixoBR(cadTelefone.value); });

document.querySelectorAll('.togglePass').forEach(btn => btn.addEventListener('click', () => {
  const input = document.getElementById(btn.dataset.pass || '');
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
}));

// === LOGIN ===
const loginForm = document.getElementById('loginForm'), loginMsg = document.getElementById('loginMsg'), loginBtn = document.getElementById('loginBtn');
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginMsg.textContent = ''; loginMsg.classList.remove('ok'); loginBtn.disabled = true; loginBtn.textContent = 'ENTRANDO...';
  try {
    const usuario = document.getElementById('loginEmail').value.trim();
    const senha = document.getElementById('loginSenha').value;
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.detail || 'Login recusado.');
    location.href = data.redirect || '/';
  } catch (err) {
    loginMsg.textContent = err.message || 'Erro ao entrar.';
  } finally { loginBtn.disabled = false; loginBtn.textContent = 'ENTRAR'; }
});

// === FORGOT PASSWORD ===
const forgotOpen = document.getElementById('forgotOpen'), forgotBox = document.getElementById('forgotBox'),
  forgotEmail = document.getElementById('forgotEmail'), forgotBtn = document.getElementById('forgotBtn'),
  forgotMsg = document.getElementById('forgotMsg');

forgotOpen.addEventListener('click', () => {
  forgotBox.classList.toggle('active');
  forgotMsg.textContent = '';
  forgotEmail.value = forgotEmail.value || document.getElementById('loginEmail').value.trim();
});

forgotBtn.addEventListener('click', async () => {
  forgotMsg.textContent = ''; forgotMsg.classList.remove('ok'); forgotBtn.disabled = true; forgotBtn.textContent = 'ENVIANDO...';
  try {
    const email = forgotEmail.value.trim();
    if (!email) throw new Error('Informe seu e-mail.');
    const res = await fetch('/api/auth/password/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.detail || 'Não foi possível solicitar recuperação.');
    forgotMsg.classList.add('ok'); forgotMsg.textContent = data.message || 'Instruções enviadas para seu e-mail.';
  } catch (err) { forgotMsg.textContent = err.message || 'Erro ao solicitar recuperação.'; }
  finally { forgotBtn.disabled = false; forgotBtn.textContent = 'ENVIAR INSTRUÇÕES'; }
});

// === VERIFY RESEND ===
const verifyBtn = document.getElementById('verifyBtn'), verifyMsg = document.getElementById('verifyMsg');
if (verifyBtn) {
  verifyBtn.addEventListener('click', async () => {
    verifyMsg.textContent = ''; verifyMsg.classList.remove('ok'); verifyBtn.disabled = true; verifyBtn.textContent = 'ENVIANDO...';
    try {
      const email = (document.getElementById('verifyEmail')?.value || document.getElementById('loginEmail').value).trim();
      const res = await fetch('/api/auth/email/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.detail || 'Não foi possível reenviar.');
      verifyMsg.classList.add('ok'); verifyMsg.textContent = data.message || 'Verifique seu e-mail.';
    } catch (err) { verifyMsg.textContent = err.message || 'Erro ao reenviar verificação.'; }
    finally { verifyBtn.disabled = false; verifyBtn.textContent = 'REENVIAR LINK DE VERIFICAÇÃO'; }
  });
}

// === CADASTRO ===
const cadForm = document.getElementById('cadastroForm'), cadMsg = document.getElementById('cadMsg'), cadBtn = document.getElementById('cadBtn');
cadForm.addEventListener('submit', async e => {
  e.preventDefault();
  cadMsg.textContent = ''; cadMsg.classList.remove('ok'); cadBtn.disabled = true; cadBtn.textContent = 'CRIANDO...';
  try {
    if (!document.getElementById('cadTermos').checked) throw new Error('Aceite os Termos de Uso.');
    if (!document.getElementById('cadMaior18').checked) throw new Error('Declare que é maior de 18 anos.');
    const payload = {
      nome: document.getElementById('cadNome').value.trim(),
      email: document.getElementById('cadEmail').value.trim(),
      telefone: document.getElementById('cadTelefone').value.trim(),
      senha: document.getElementById('cadSenha').value,
      confirma_senha: document.getElementById('cadConfirma').value
    };
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.detail || 'Erro ao cadastrar.');
    cadMsg.classList.add('ok'); cadMsg.textContent = data.message || 'Cadastro realizado! Faça login.';
    document.getElementById('loginEmail').value = payload.email;
    cadForm.reset();
    setTimeout(() => { showTab('login'); loginMsg.classList.add('ok'); loginMsg.textContent = 'Cadastro realizado. Faça login.'; }, 900);
  } catch (err) { cadMsg.textContent = err.message || 'Erro ao cadastrar.'; }
  finally { cadBtn.disabled = false; cadBtn.textContent = 'CRIAR MINHA CONTA'; }
});