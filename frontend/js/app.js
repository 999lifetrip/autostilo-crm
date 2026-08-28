/* ═══════════════════════════════════════════════════════════════
   AutoStilo CRM — Frontend Application Logic
═══════════════════════════════════════════════════════════════ */

const API = '/api';
let token = localStorage.getItem('crm_token');
let currentUser = null;
let currentLeadData = null;
let leadsState = { pagina: 1, busca: '', ia_ativa: '', etiqueta: 'todos' };
let usuarios = [];
let refreshInterval = null;

// ─── Helpers ──────────────────────────────────────────────────
function api(endpoint, options = {}) {
    return fetch(`${API}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
    }).then(async r => {
        if (!r.ok) {
            const err = await r.json().catch(() => ({ error: r.statusText }));
            throw new Error(err.error || 'Erro desconhecido');
        }
        return r.json();
    });
}

function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
    el.className = `toast toast-${type}`;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function formatTel(tel) {
    if (!tel) return '';
    const n = tel.replace(/\D/g, '');
    if (n.length >= 12) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`;
    return tel;
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Agora';
    if (mins < 60) return `${mins}m atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    return `${Math.floor(hrs / 24)}d atrás`;
}

function initials(nome) {
    if (!nome) return '?';
    return nome.split(' ').slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

const ETIQUETAS = {
    novo: { emoji: '🆕', label: 'Novo', cls: 'badge-novo' },
    quente: { emoji: '🔥', label: 'Quente', cls: 'badge-quente' },
    agendado: { emoji: '📅', label: 'Agendado', cls: 'badge-agendado' },
    fechou: { emoji: '✅', label: 'Fechou', cls: 'badge-fechou' },
    perdeu: { emoji: '❌', label: 'Perdeu', cls: 'badge-perdeu' },
    aguardando: { emoji: '🕐', label: 'Aguardando', cls: 'badge-aguardando' },
};

function badgeEtiqueta(e) {
    const t = ETIQUETAS[e] || { emoji: '', label: e || 'novo', cls: 'badge-novo' };
    return `<span class="badge ${t.cls}">${t.emoji} ${t.label}</span>`;
}

// ─── Clock ─────────────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('headerTime');
    const tick = () => {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    tick(); setInterval(tick, 1000);
}

// ─── Auth ──────────────────────────────────────────────────────
async function checkAuth() {
    if (!token) { showLogin(); return; }
    try {
        // Decode token
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) { logout(); return; }
        currentUser = payload;
        showApp();
    } catch { logout(); }
}

function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Update user info
    document.getElementById('userName').textContent = currentUser.nome;
    document.getElementById('userRole').textContent = currentUser.role;
    document.getElementById('userAvatar').textContent = initials(currentUser.nome);

    startClock();
    loadDashboard();
    loadLeads();
    loadUsuarios();
    startAutoRefresh();
}

function logout() {
    localStorage.removeItem('crm_token');
    token = null; currentUser = null;
    if (refreshInterval) clearInterval(refreshInterval);
    showLogin();
}

// ─── Login form ────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-loader').classList.remove('hidden');
    errEl.classList.add('hidden');
    try {
        const email = document.getElementById('loginEmail').value;
        const senha = document.getElementById('loginSenha').value;
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('crm_token', token);
        showApp();
    } catch {
        errEl.classList.remove('hidden');
    } finally {
        btn.querySelector('.btn-text').classList.remove('hidden');
        btn.querySelector('.btn-loader').classList.add('hidden');
    }
});

document.getElementById('toggleSenha').addEventListener('click', () => {
    const input = document.getElementById('loginSenha');
    input.type = input.type === 'password' ? 'text' : 'password';
});
document.getElementById('btnLogout').addEventListener('click', logout);

// ─── Navigation ────────────────────────────────────────────────
const pages = {
    dashboard: { page: 'pageDashboard', title: 'Dashboard' },
    leads: { page: 'pageLeads', title: 'Leads' },
    equipe: { page: 'pageEquipe', title: 'Equipe' },
};

function navigate(key) {
    Object.keys(pages).forEach(k => {
        const navBtn = document.getElementById(`nav${k.charAt(0).toUpperCase() + k.slice(1)}`);
        const pageEl = document.getElementById(pages[k].page);
        if (k === key) {
            navBtn?.classList.add('active');
            pageEl?.classList.add('active');
        } else {
            navBtn?.classList.remove('active');
            pageEl?.classList.remove('active');
        }
    });
    document.getElementById('headerTitle').textContent = pages[key].title;
    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
});

document.getElementById('btnMenuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ─── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const data = await api('/dashboard');

        // Update date
        document.getElementById('dashDate').textContent =
            new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

        // Stats
        document.getElementById('statTotalLeads').textContent = data.total_leads ?? 0;
        document.getElementById('statIaAtiva').textContent = data.ia_ativa ?? 0;
        document.getElementById('statIaOff').textContent = data.ia_off ?? 0;
        document.getElementById('statEscaladosHoje').textContent = data.escalados_hoje ?? 0;
        document.getElementById('badgeLeads').textContent = data.ativos_hoje ?? 0;

        // Etiquetas chart
        renderEtiquetasChart(data.etiquetas || []);

        // Atividade chart
        renderAtividadeChart(data.atividade || []);

        // Escalados recentes — load separately from leads filtered
        loadEscaladosRecentes();

    } catch (e) {
        console.error('Dashboard error:', e);
    }
}

function renderEtiquetasChart(etiquetas) {
    const el = document.getElementById('etiquetasChart');
    if (!etiquetas.length) { el.innerHTML = '<div class="empty-state">Sem dados ainda</div>'; return; }
    const max = Math.max(...etiquetas.map(e => parseInt(e.total)));
    el.innerHTML = etiquetas.map(e => {
        const pct = max > 0 ? Math.round((parseInt(e.total) / max) * 100) : 0;
        const info = ETIQUETAS[e.etiqueta] || { emoji: '', label: e.etiqueta };
        return `<div class="etiqueta-bar">
            <div class="etiqueta-bar-label">
                <span>${info.emoji} ${info.label}</span>
                <span>${e.total}</span>
            </div>
            <div class="etiqueta-bar-track">
                <div class="etiqueta-bar-fill" style="width:${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

function renderAtividadeChart(atividade) {
    const el = document.getElementById('atividadeChart');
    if (!atividade.length) { el.innerHTML = '<div class="empty-state">Sem dados ainda</div>'; return; }
    const max = Math.max(...atividade.map(a => parseInt(a.total)));
    el.innerHTML = atividade.map(a => {
        const pct = max > 0 ? Math.round((parseInt(a.total) / max) * 100) : 4;
        const dia = new Date(a.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return `<div class="ativ-bar-wrap">
            <div class="ativ-bar" style="height:${Math.max(pct, 4)}%" data-val="${a.total}"></div>
            <span class="ativ-label">${dia}</span>
        </div>`;
    }).join('');
}

async function loadEscaladosRecentes() {
    try {
        const data = await api('/leads?ia_ativa=false&limite=5');
        const el = document.getElementById('escaladosList');
        if (!data.leads.length) {
            el.innerHTML = '<div class="empty-state">Sem atendimentos humanos no momento 🎉</div>';
            return;
        }
        el.innerHTML = data.leads.map(l => `
            <div class="escalado-item" onclick="openLead('${encodeURIComponent(l.telefone)}')">
                <div class="lead-avatar">${initials(l.nome || l.telefone)}</div>
                <div>
                    <div class="escalado-nome">${l.nome || formatTel(l.telefone)}</div>
                    <div class="escalado-tel">${formatTel(l.telefone)}</div>
                </div>
                <div class="escalado-tempo">${timeAgo(l.ultima_interacao)}</div>
            </div>
        `).join('');
    } catch {}
}

// ─── Leads ─────────────────────────────────────────────────────
async function loadLeads() {
    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading"><div class="spinner"></div> Carregando...</td></tr>`;
    try {
        const params = new URLSearchParams({
            pagina: leadsState.pagina,
            limite: 15,
        });
        if (leadsState.busca) params.set('busca', leadsState.busca);
        if (leadsState.ia_ativa !== '') params.set('ia_ativa', leadsState.ia_ativa);
        if (leadsState.etiqueta !== 'todos') params.set('etiqueta', leadsState.etiqueta);

        const data = await api(`/leads?${params}`);
        renderLeadsTable(data.leads);
        renderPagination(data.total_paginas, data.pagina);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:var(--red)">❌ Erro: ${e.message}</td></tr>`;
    }
}

function renderLeadsTable(leads) {
    const tbody = document.getElementById('leadsTableBody');
    if (!leads.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Nenhum lead encontrado</td></tr>`;
        return;
    }
    tbody.innerHTML = leads.map(l => `
        <tr onclick="openLead('${encodeURIComponent(l.telefone)}')">
            <td>
                <div class="lead-cell">
                    <div class="lead-avatar">${initials(l.nome || l.telefone)}</div>
                    <div>
                        <div class="lead-name">${l.nome || '(sem nome)'}</div>
                        <div class="lead-phone">${formatTel(l.telefone)}</div>
                    </div>
                </div>
            </td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:0.82rem">
                ${l.ultima_mensagem || '—'}
            </td>
            <td>${badgeEtiqueta(l.etiqueta)}</td>
            <td style="color:var(--text-secondary);font-size:0.82rem">${l.vendedor_nome || '—'}</td>
            <td>
                <span class="ia-badge ${l.ia_ativa ? 'ia-on' : 'ia-off'}">
                    ${l.ia_ativa ? '🤖 IA Ativa' : '👤 Humano'}
                </span>
            </td>
            <td style="color:var(--text-secondary);font-size:0.8rem">${timeAgo(l.ultima_interacao)}</td>
            <td><button class="btn-detail" onclick="event.stopPropagation();openLead('${encodeURIComponent(l.telefone)}')">Ver →</button></td>
        </tr>
    `).join('');
}

function renderPagination(total, atual) {
    const el = document.getElementById('pagination');
    if (total <= 1) { el.innerHTML = ''; return; }
    let html = `<button class="page-btn" onclick="goPage(${atual-1})" ${atual<=1?'disabled':''}>‹</button>`;
    for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || Math.abs(i - atual) <= 2) {
            html += `<button class="page-btn ${i===atual?'active':''}" onclick="goPage(${i})">${i}</button>`;
        } else if (Math.abs(i - atual) === 3) {
            html += `<span style="color:var(--text-muted);padding:0 4px">…</span>`;
        }
    }
    html += `<button class="page-btn" onclick="goPage(${atual+1})" ${atual>=total?'disabled':''}>›</button>`;
    el.innerHTML = html;
}

window.goPage = (p) => { leadsState.pagina = p; loadLeads(); };

// Search
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        leadsState.busca = e.target.value;
        leadsState.pagina = 1;
        loadLeads();
    }, 350);
});

// Filters
document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const filter = chip.dataset.filter;
        document.querySelectorAll(`.filter-chip[data-filter="${filter}"]`).forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        leadsState[filter] = chip.dataset.value;
        leadsState.pagina = 1;
        loadLeads();
    });
});

document.getElementById('filterEtiqueta').addEventListener('change', e => {
    leadsState.etiqueta = e.target.value;
    leadsState.pagina = 1;
    loadLeads();
});

// ─── Lead Modal ────────────────────────────────────────────────
window.openLead = async (telEncoded) => {
    const tel = decodeURIComponent(telEncoded);
    const modal = document.getElementById('modalLead');
    modal.classList.remove('hidden');

    // Reset
    document.getElementById('chatView').innerHTML = '<div class="chat-loading">Carregando conversa...</div>';
    document.getElementById('modalLeadNome').textContent = '...';
    document.getElementById('modalLeadTelefone').textContent = tel;
    document.getElementById('modalAvatar').textContent = '?';

    try {
        const data = await api(`/leads/${telEncoded}`);
        currentLeadData = data.lead;
        renderLeadModal(data.lead, data.historico);
    } catch (e) {
        toast('Erro ao carregar lead: ' + e.message, 'error');
    }
};

function renderLeadModal(lead, historico) {
    document.getElementById('modalLeadNome').textContent = lead.nome || '(sem nome)';
    document.getElementById('modalLeadTelefone').textContent = formatTel(lead.telefone);
    document.getElementById('modalAvatar').textContent = initials(lead.nome || lead.telefone);

    // IA toggle
    const iaToggle = document.getElementById('iaToggle');
    iaToggle.checked = lead.ia_ativa;
    updateIaLabel(lead.ia_ativa);

    // Etiquetas
    const etiquetaGrid = document.getElementById('etiquetaGrid');
    etiquetaGrid.innerHTML = Object.entries(ETIQUETAS).map(([k, v]) =>
        `<button class="etiqueta-btn ${lead.etiqueta === k ? 'active-etiqueta' : ''}" data-etiqueta="${k}">${v.emoji} ${v.label}</button>`
    ).join('');
    etiquetaGrid.querySelectorAll('.etiqueta-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            etiquetaGrid.querySelectorAll('.etiqueta-btn').forEach(b => b.classList.remove('active-etiqueta'));
            btn.classList.add('active-etiqueta');
        });
    });

    // Vendedor select
    const sel = document.getElementById('vendedorSelect');
    sel.innerHTML = `<option value="">— Sem vendedor —</option>` +
        usuarios.map(u => `<option value="${u.id}" ${lead.vendedor_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');

    // Anotações
    document.getElementById('anotacoesInput').value = lead.anotacoes || '';

    // Histórico do chat
    renderChat(historico);
}

function updateIaLabel(isOn) {
    const lbl = document.getElementById('iaStatusLabel');
    lbl.textContent = isOn ? '🤖 IA Ativa' : '👤 Atendimento Humano';
    lbl.className = `ia-status-label ${isOn ? 'ia-on' : 'ia-off'}`;
}

document.getElementById('iaToggle').addEventListener('change', e => updateIaLabel(e.target.checked));

function renderChat(historico) {
    const view = document.getElementById('chatView');
    if (!historico || !historico.length) {
        view.innerHTML = '<div class="chat-loading">Sem histórico registrado</div>';
        return;
    }
    // historico is from n8n_historico_mensagens — field names may vary
    view.innerHTML = historico.slice().reverse().map(msg => {
        const isHuman = msg.type === 'human' || msg.role === 'human' || msg.type === 'incoming';
        const content = msg.data?.content || msg.content || msg.message || '…';
        const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="chat-bubble ${isHuman ? 'user' : 'bot'}">
            ${content}
            ${time ? `<div class="chat-time">${time}</div>` : ''}
        </div>`;
    }).join('');
    view.scrollTop = view.scrollHeight;
}

// Salvar lead
document.getElementById('btnSalvarLead').addEventListener('click', async () => {
    if (!currentLeadData) return;
    const tel = encodeURIComponent(currentLeadData.telefone);
    const etiqueta = document.querySelector('.etiqueta-btn.active-etiqueta')?.dataset.etiqueta;
    try {
        await api(`/leads/${tel}`, {
            method: 'PATCH',
            body: JSON.stringify({
                ia_ativa: document.getElementById('iaToggle').checked,
                etiqueta,
                vendedor_id: document.getElementById('vendedorSelect').value || null,
                anotacoes: document.getElementById('anotacoesInput').value,
            }),
        });
        toast('Lead atualizado com sucesso!');
        loadLeads(); loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
});

// Enviar msg manual
document.getElementById('btnEnviarMsg').addEventListener('click', async () => {
    if (!currentLeadData) return;
    const texto = document.getElementById('msgManualInput').value.trim();
    if (!texto) return;
    try {
        await api(`/leads/${encodeURIComponent(currentLeadData.telefone)}/mensagem`, {
            method: 'POST',
            body: JSON.stringify({ texto }),
        });
        document.getElementById('msgManualInput').value = '';
        toast('Mensagem enviada!');
    } catch (e) { toast(e.message, 'error'); }
});

// Close modal
document.getElementById('modalLeadClose').addEventListener('click', () => {
    document.getElementById('modalLead').classList.add('hidden');
});
document.getElementById('modalLead').addEventListener('click', e => {
    if (e.target === document.getElementById('modalLead'))
        document.getElementById('modalLead').classList.add('hidden');
});

// ─── Equipe ────────────────────────────────────────────────────
async function loadUsuarios() {
    try {
        usuarios = await api('/usuarios');
        renderEquipe();
    } catch {}
}

function renderEquipe() {
    const grid = document.getElementById('equipeGrid');
    if (!usuarios.length) { grid.innerHTML = '<div class="loading-placeholder">Nenhum membro cadastrado</div>'; return; }
    grid.innerHTML = usuarios.map(u => `
        <div class="team-card">
            <div class="team-avatar">${initials(u.nome)}</div>
            <div class="team-name">${u.nome}</div>
            <div class="team-email">${u.email}</div>
            <span class="team-badge ${u.role === 'admin' ? 'admin' : ''}">${u.role}</span>
        </div>
    `).join('');
}

// Novo usuário modal
document.getElementById('btnNovoUsuario').addEventListener('click', () => {
    document.getElementById('modalUsuario').classList.remove('hidden');
});
document.getElementById('modalUsuarioClose').addEventListener('click', () => {
    document.getElementById('modalUsuario').classList.add('hidden');
});
document.getElementById('btnCancelarUsuario').addEventListener('click', () => {
    document.getElementById('modalUsuario').classList.add('hidden');
});
document.getElementById('formUsuario').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        await api('/usuarios', {
            method: 'POST',
            body: JSON.stringify({
                nome: document.getElementById('usuarioNome').value,
                email: document.getElementById('usuarioEmail').value,
                senha: document.getElementById('usuarioSenha').value,
                role: document.getElementById('usuarioRole').value,
            }),
        });
        document.getElementById('modalUsuario').classList.add('hidden');
        document.getElementById('formUsuario').reset();
        toast('Membro criado com sucesso!');
        loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
});

// ─── Auto refresh ──────────────────────────────────────────────
function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        const activePage = document.querySelector('.page.active');
        if (activePage?.id === 'pageDashboard') loadDashboard();
        if (activePage?.id === 'pageLeads') loadLeads();
    }, 30000); // refresh a cada 30s
}

// ─── Boot ──────────────────────────────────────────────────────
checkAuth();
