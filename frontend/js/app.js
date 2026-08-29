/* ═══════════════════════════════════════════════════════════════
   AutoStilo CRM — Frontend Application Logic
═══════════════════════════════════════════════════════════════ */

const API = '/api';
let token = localStorage.getItem('crm_token');
let currentUser = null;
let currentLeadData = null;
let leadsState = { pagina: 1, busca: '', ia_ativa: '', etiqueta: 'todos' };
let veiculosState = { busca: '', destaque: '', ativo: '' };
let usuarios = [];
let refreshInterval = null;
let pendingPhotos = []; // para o modal de cadastro/edição de veículos
let activeGalleryVehicleId = null;

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

function formatMoeda(val) {
    if (val === null || val === undefined || val === '') return 'R$ 0,00';
    return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
    com_vendedor: { emoji: '👤', label: 'Com Vendedor', cls: 'badge-perdeu' },
    em_atendimento: { emoji: '💬', label: 'Em Atendimento', cls: 'badge-quente' },
};

function badgeEtiqueta(e) {
    const t = ETIQUETAS[e] || { emoji: '🏷️', label: e || 'novo', cls: 'badge-novo' };
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

    document.getElementById('userName').textContent = currentUser.nome;
    document.getElementById('userRole').textContent = currentUser.role;
    document.getElementById('userAvatar').textContent = initials(currentUser.nome);

    startClock();
    loadDashboard();
    loadLeads();
    loadVeiculos();
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
    dashboard: { page: 'pageDashboard', title: 'Dashboard Geral' },
    leads: { page: 'pageLeads', title: 'Gestão de Leads WhatsApp' },
    veiculos: { page: 'pageVeiculos', title: 'Estoque de Veículos & Fotos' },
    equipe: { page: 'pageEquipe', title: 'Equipe de Vendas' },
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
    document.getElementById('sidebar').classList.remove('open');

    if (key === 'veiculos') loadVeiculos();
    if (key === 'leads') loadLeads();
    if (key === 'dashboard') loadDashboard();
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

        document.getElementById('dashDate').textContent =
            new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

        document.getElementById('statTotalLeads').textContent = data.total_leads ?? 0;
        document.getElementById('statIaAtiva').textContent = data.ia_ativa ?? 0;
        document.getElementById('statIaOff').textContent = data.ia_off ?? 0;
        document.getElementById('statEscaladosHoje').textContent = data.escalados_hoje ?? 0;
        document.getElementById('badgeLeads').textContent = data.total_leads ?? 0;

        renderEtiquetasChart(data.etiquetas || []);
        renderAtividadeChart(data.atividade || []);
        loadEscaladosRecentes();
    } catch {}
}

function renderEtiquetasChart(etiquetas) {
    const el = document.getElementById('etiquetasChart');
    if (!etiquetas.length) { el.innerHTML = '<div class="empty-state">Sem dados de funil ainda</div>'; return; }
    const total = etiquetas.reduce((s, e) => s + parseInt(e.total), 0);
    el.innerHTML = etiquetas.map(e => {
        const pct = total > 0 ? Math.round((parseInt(e.total) / total) * 100) : 0;
        const info = ETIQUETAS[e.etiqueta] || { emoji: '🏷️', label: e.etiqueta };
        return `<div class="chart-row">
            <div class="chart-label">${info.emoji} ${info.label}</div>
            <div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
            <div class="chart-val">${e.total} (${pct}%)</div>
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
                <button class="ia-toggle-btn ${l.ia_ativa ? 'ia-on' : 'ia-off'}" 
                        onclick="event.stopPropagation(); toggleIaStatus('${encodeURIComponent(l.telefone)}', ${l.ia_ativa})" 
                        title="Clique para alternar entre IA Ativa e Atendimento Humano">
                    <span class="ia-toggle-icon">${l.ia_ativa ? '🤖' : '👤'}</span>
                    <span class="ia-toggle-text">${l.ia_ativa ? 'IA Ativa' : 'Humano'}</span>
                    <span class="ia-toggle-switch"></span>
                </button>
            </td>
            <td style="color:var(--text-secondary);font-size:0.8rem">${timeAgo(l.ultima_interacao)}</td>
            <td><button class="btn-detail" onclick="event.stopPropagation();openLead('${encodeURIComponent(l.telefone)}')">Ver →</button></td>
        </tr>
    `).join('');
}

// ─── TOGGLE IA RÁPIDO ON/OFF ───────────────────────────────────
window.toggleIaStatus = async (telEncoded, currentStatus) => {
    const tel = decodeURIComponent(telEncoded);
    try {
        const data = await api(`/leads/${telEncoded}/toggle-ia`, { method: 'POST' });
        if (data.ia_ativa) {
            toast(`🤖 IA ATIVADA para ${formatTel(tel)}! O robô voltará a responder.`);
        } else {
            toast(`👤 IA DESATIVADA para ${formatTel(tel)} (Atendimento Humano assumiu).`);
        }
        loadLeads();
        loadDashboard();
    } catch (e) {
        toast('Erro ao alterar status da IA: ' + e.message, 'error');
    }
};

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

// Search Leads
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        leadsState.busca = e.target.value;
        leadsState.pagina = 1;
        loadLeads();
    }, 350);
});

// Filters Leads
document.querySelectorAll('.filter-chips .filter-chip[data-filter="ia_ativa"]').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chips .filter-chip[data-filter="ia_ativa"]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        leadsState.ia_ativa = chip.dataset.value;
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

    const iaToggle = document.getElementById('iaToggle');
    iaToggle.checked = lead.ia_ativa;
    updateIaLabel(lead.ia_ativa);

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

    const sel = document.getElementById('vendedorSelect');
    sel.innerHTML = `<option value="">— Sem vendedor —</option>` +
        usuarios.map(u => `<option value="${u.id}" ${lead.vendedor_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');

    document.getElementById('anotacoesInput').value = lead.anotacoes || '';

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

// Close modal lead
document.getElementById('modalLeadClose').addEventListener('click', () => {
    document.getElementById('modalLead').classList.add('hidden');
});
document.getElementById('modalLead').addEventListener('click', e => {
    if (e.target === document.getElementById('modalLead'))
        document.getElementById('modalLead').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════
// ─── ESTOQUE DE VEÍCULOS & GESTÃO DE FOTOS ────────────────────
// ═══════════════════════════════════════════════════════════════

async function loadVeiculos() {
    const grid = document.getElementById('veiculosGrid');
    grid.innerHTML = `<div class="loading-placeholder"><div class="spinner"></div> Carregando estoque de veículos...</div>`;
    try {
        const params = new URLSearchParams();
        if (veiculosState.busca) params.set('busca', veiculosState.busca);
        if (veiculosState.destaque !== '') params.set('destaque', veiculosState.destaque);
        if (veiculosState.ativo !== '') params.set('ativo', veiculosState.ativo);

        const veiculos = await api(`/veiculos?${params}`);
        document.getElementById('badgeVeiculos').textContent = veiculos.length;
        renderVeiculosGrid(veiculos);
    } catch (e) {
        grid.innerHTML = `<div class="loading-placeholder" style="color:var(--red)">❌ Erro ao carregar veículos: ${e.message}</div>`;
    }
}

function renderVeiculosGrid(veiculos) {
    const grid = document.getElementById('veiculosGrid');
    if (!veiculos.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem; text-align:center;">
                <div style="font-size:3rem; margin-bottom:0.75rem;">🚗</div>
                <div style="font-size:1.1rem; font-weight:700; color:#fff;">Nenhum veículo encontrado</div>
                <p style="color:var(--text-secondary); margin: 0.5rem 0 1.5rem;">Cadastre novos carros com fotos para o Iago consultar e enviar aos clientes.</p>
                <button class="btn btn-primary" onclick="openModalVeiculo()">+ Cadastrar Primeiro Carro</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = veiculos.map(v => {
        const capaSrc = v.foto_capa ? `data:image/jpeg;base64,${v.foto_capa}` : '';
        return `
            <div class="veiculo-card ${v.destaque ? 'is-destaque' : ''}">
                <div class="veiculo-thumb-wrap">
                    ${capaSrc ? `
                        <img src="${capaSrc}" alt="${v.modelo}" class="veiculo-thumb" loading="lazy">
                    ` : `
                        <div class="veiculo-thumb-empty">
                            <span>🚗</span>
                            <span>Sem foto de capa</span>
                        </div>
                    `}
                    <span class="badge-photo-count">📸 ${v.total_fotos || 0} fotos</span>
                    ${v.destaque ? `<span class="badge-card-destaque">⭐ Destaque</span>` : ''}
                </div>
                <div class="veiculo-info">
                    <div class="veiculo-header">
                        <div>
                            <div class="veiculo-title">${v.modelo}</div>
                            <div class="veiculo-marca-ano">${v.marca || 'AutoStilo'} • ${v.ano || '—'}</div>
                        </div>
                        <div class="veiculo-preco">${formatMoeda(v.preco)}</div>
                    </div>

                    <div class="veiculo-tags">
                        ${v.cambio ? `<span class="v-tag">🕹️ ${v.cambio}</span>` : ''}
                        ${v.km ? `<span class="v-tag">🛣️ ${Number(v.km).toLocaleString('pt-BR')} km</span>` : ''}
                        ${v.combustivel ? `<span class="v-tag">⛽ ${v.combustivel}</span>` : ''}
                        ${v.cor ? `<span class="v-tag">🎨 ${v.cor}</span>` : ''}
                    </div>

                    ${v.diferenciais ? `
                        <div class="veiculo-diferenciais-preview" title="${v.diferenciais}">
                            ✨ ${v.diferenciais}
                        </div>
                    ` : ''}

                    <div class="veiculo-actions">
                        <button class="btn btn-secondary btn-sm" onclick="openGalleryModal(${v.id}, '${encodeURIComponent(v.modelo)}', '${encodeURIComponent(v.ano || '')}')">
                            📸 Fotos (${v.total_fotos || 0})
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="openModalVeiculo(${v.id})" title="Editar veículo">
                            ✏️
                        </button>
                        <button class="btn btn-ghost btn-sm" style="color:#f87171" onclick="excluirVeiculo(${v.id}, '${encodeURIComponent(v.modelo)}')" title="Excluir veículo">
                            🗑️
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Search & Filters Veículos
let searchVeiculosTimeout;
document.getElementById('searchVeiculos').addEventListener('input', e => {
    clearTimeout(searchVeiculosTimeout);
    searchVeiculosTimeout = setTimeout(() => {
        veiculosState.busca = e.target.value;
        loadVeiculos();
    }, 350);
});

document.querySelectorAll('[data-filter-veiculo]').forEach(chip => {
    chip.addEventListener('click', () => {
        const filter = chip.dataset.filterVeiculo;
        document.querySelectorAll('[data-filter-veiculo]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (filter === 'destaque') {
            veiculosState.destaque = chip.dataset.value;
            veiculosState.ativo = '';
        } else if (filter === 'ativo') {
            veiculosState.ativo = chip.dataset.value;
            veiculosState.destaque = '';
        } else {
            veiculosState.destaque = '';
            veiculosState.ativo = '';
        }
        loadVeiculos();
    });
});

// ─── Modal Novo / Editar Veículo ───────────────────────────────
document.getElementById('btnNovoVeiculo').addEventListener('click', () => openModalVeiculo());

window.openModalVeiculo = async (id = null) => {
    const modal = document.getElementById('modalVeiculo');
    const form = document.getElementById('formVeiculo');
    form.reset();
    pendingPhotos = [];
    renderPhotosPreview();

    if (id) {
        document.getElementById('modalVeiculoTitle').textContent = '✏️ Editar Veículo';
        try {
            const data = await api(`/veiculos/${id}`);
            const v = data.veiculo;
            document.getElementById('veiculoId').value = v.id;
            document.getElementById('veiculoModelo').value = v.modelo || '';
            document.getElementById('veiculoMarca').value = v.marca || '';
            document.getElementById('veiculoAno').value = v.ano || '';
            document.getElementById('veiculoPreco').value = v.preco || '';
            document.getElementById('veiculoCor').value = v.cor || '';
            document.getElementById('veiculoCambio').value = v.cambio || 'Manual';
            document.getElementById('veiculoKm').value = v.km || '';
            document.getElementById('veiculoCombustivel').value = v.combustivel || 'Flex';
            document.getElementById('veiculoOpcionais').value = v.opcionais || '';
            document.getElementById('veiculoDiferenciais').value = v.diferenciais || '';
            document.getElementById('veiculoDescricao').value = v.descricao || '';
            document.getElementById('veiculoDestaque').checked = Boolean(v.destaque);
            document.getElementById('veiculoAtivo').checked = Boolean(v.ativo);
        } catch (e) {
            toast('Erro ao carregar dados do carro: ' + e.message, 'error');
            return;
        }
    } else {
        document.getElementById('modalVeiculoTitle').textContent = '🚗 Cadastrar Novo Veículo';
        document.getElementById('veiculoId').value = '';
        document.getElementById('veiculoAtivo').checked = true;
    }

    modal.classList.remove('hidden');
};

document.getElementById('modalVeiculoClose').addEventListener('click', () => {
    document.getElementById('modalVeiculo').classList.add('hidden');
});
document.getElementById('btnCancelarVeiculo').addEventListener('click', () => {
    document.getElementById('modalVeiculo').classList.add('hidden');
});

// Photo upload handlers (Drag & Drop + File selector)
const photoDropzone = document.getElementById('photoDropzone');
const photoInput = document.getElementById('photoInput');

photoDropzone.addEventListener('dragover', e => {
    e.preventDefault();
    photoDropzone.classList.add('dragover');
});
photoDropzone.addEventListener('dragleave', () => photoDropzone.classList.remove('dragover'));
photoDropzone.addEventListener('drop', e => {
    e.preventDefault();
    photoDropzone.classList.remove('dragover');
    if (e.dataTransfer.files) handlePhotoFiles(e.dataTransfer.files);
});
photoInput.addEventListener('change', e => {
    if (e.target.files) handlePhotoFiles(e.target.files);
});

function handlePhotoFiles(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            pendingPhotos.push({
                nome: file.name,
                mimetype: file.type,
                base64: reader.result,
            });
            renderPhotosPreview();
        };
        reader.readAsDataURL(file);
    });
}

function renderPhotosPreview() {
    const grid = document.getElementById('photosPreviewGrid');
    grid.innerHTML = pendingPhotos.map((p, idx) => `
        <div class="preview-thumb-card">
            <img src="${p.base64}" class="preview-thumb-img" alt="Foto ${idx+1}">
            <button type="button" class="preview-thumb-delete" onclick="removePendingPhoto(${idx})" title="Remover">✕</button>
        </div>
    `).join('');
}

window.removePendingPhoto = (idx) => {
    pendingPhotos.splice(idx, 1);
    renderPhotosPreview();
};

// Submeter Formulário de Veículo
document.getElementById('formVeiculo').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btnSalvarVeiculo');
    const originalText = btn.textContent;
    btn.textContent = 'Salvando...';
    btn.disabled = true;

    const id = document.getElementById('veiculoId').value;
    const payload = {
        modelo: document.getElementById('veiculoModelo').value.trim(),
        marca: document.getElementById('veiculoMarca').value.trim(),
        ano: document.getElementById('veiculoAno').value.trim(),
        preco: parseFloat(document.getElementById('veiculoPreco').value) || 0,
        cor: document.getElementById('veiculoCor').value.trim(),
        cambio: document.getElementById('veiculoCambio').value,
        km: parseInt(document.getElementById('veiculoKm').value) || 0,
        combustivel: document.getElementById('veiculoCombustivel').value.trim(),
        opcionais: document.getElementById('veiculoOpcionais').value.trim(),
        diferenciais: document.getElementById('veiculoDiferenciais').value.trim(),
        descricao: document.getElementById('veiculoDescricao').value.trim(),
        destaque: document.getElementById('veiculoDestaque').checked,
        ativo: document.getElementById('veiculoAtivo').checked,
    };

    try {
        if (id) {
            payload.novas_fotos = pendingPhotos;
            await api(`/veiculos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            toast('Veículo atualizado com sucesso!');
        } else {
            payload.fotos = pendingPhotos;
            await api('/veiculos', { method: 'POST', body: JSON.stringify(payload) });
            toast('Novo veículo cadastrado com sucesso!');
        }
        document.getElementById('modalVeiculo').classList.add('hidden');
        loadVeiculos();
    } catch (err) {
        toast('Erro ao salvar veículo: ' + err.message, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

// Excluir Veículo
window.excluirVeiculo = async (id, modeloEncoded) => {
    const modelo = decodeURIComponent(modeloEncoded);
    if (!confirm(`Tem certeza que deseja excluir o ${modelo}? Todas as fotos serão removidas.`)) return;
    try {
        await api(`/veiculos/${id}`, { method: 'DELETE' });
        toast(`Veículo ${modelo} excluído.`);
        loadVeiculos();
    } catch (e) {
        toast('Erro ao excluir: ' + e.message, 'error');
    }
};

// ─── Modal Galeria de Fotos ────────────────────────────────────
window.openGalleryModal = async (veiculoId, modeloEncoded, anoEncoded) => {
    activeGalleryVehicleId = veiculoId;
    const modelo = decodeURIComponent(modeloEncoded);
    const ano = decodeURIComponent(anoEncoded);

    document.getElementById('galleryCarTitle').textContent = `Fotos do ${modelo} ${ano}`;
    document.getElementById('galleryCarSub').textContent = `Gerencie as fotos que a IA envia aos clientes`;
    document.getElementById('carGalleryGrid').innerHTML = '<div class="loading-placeholder"><div class="spinner"></div> Carregando fotos...</div>';
    document.getElementById('modalFotosVeiculo').classList.remove('hidden');

    loadGalleryPhotos(veiculoId);
};

async function loadGalleryPhotos(veiculoId) {
    try {
        const data = await api(`/veiculos/${veiculoId}`);
        const fotos = data.fotos || [];
        document.getElementById('galleryCountBadge').textContent = `${fotos.length} fotos cadastradas`;

        const grid = document.getElementById('carGalleryGrid');
        if (!fotos.length) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 2.5rem; text-align:center;">
                    <span style="font-size:2.5rem; display:block; margin-bottom:0.5rem;">📷</span>
                    <p style="color:var(--text-secondary);">Nenhuma foto cadastrada para este carro ainda.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = fotos.map((f, idx) => {
            const isCapa = idx === 0;
            return `
                <div class="gallery-photo-card ${isCapa ? 'is-capa' : ''}">
                    ${isCapa ? `<span class="badge-capa-destaque">⭐ Foto Principal (Capa)</span>` : ''}
                    <img src="data:${f.mimetype || 'image/jpeg'};base64,${f.base64}" class="gallery-photo-img" alt="Foto ${idx+1}">
                    <button class="gallery-photo-delete" onclick="excluirFoto(${f.id}, ${veiculoId})" title="Excluir esta foto">
                        🗑️ Excluir
                    </button>
                    ${!isCapa ? `
                        <div class="gallery-photo-bottom">
                            <button class="btn-definir-capa" onclick="definirCapaFoto(${f.id}, ${veiculoId})">
                                ⭐ Definir como Capa Principal
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (e) {
        toast('Erro ao carregar fotos: ' + e.message, 'error');
    }
}

window.definirCapaFoto = async (fotoId, veiculoId) => {
    try {
        await api(`/veiculos/${veiculoId}/capa/${fotoId}`, { method: 'POST' });
        toast('⭐ Foto definida como capa principal! O Iago enviará esta foto primeiro com a ficha técnica do carro.');
        loadGalleryPhotos(veiculoId);
        loadVeiculos();
    } catch (e) {
        toast('Erro ao definir foto de capa: ' + e.message, 'error');
    }
};

// Upload adicional de fotos direto na Galeria
document.getElementById('galleryUploadInput').addEventListener('change', async e => {
    if (!e.target.files || !e.target.files.length || !activeGalleryVehicleId) return;
    const files = Array.from(e.target.files);
    const fotosToAdd = [];

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const b64 = await new Promise(res => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(file);
        });
        fotosToAdd.push({
            nome: file.name,
            mimetype: file.type,
            base64: b64,
        });
    }

    try {
        toast(`Enviando ${fotosToAdd.length} foto(s)...`);
        await api(`/veiculos/${activeGalleryVehicleId}`, {
            method: 'PUT',
            body: JSON.stringify({ novas_fotos: fotosToAdd }),
        });
        toast('Fotos adicionadas com sucesso!');
        loadGalleryPhotos(activeGalleryVehicleId);
        loadVeiculos();
    } catch (err) {
        toast('Erro ao enviar fotos: ' + err.message, 'error');
    } finally {
        e.target.value = '';
    }
});

window.excluirFoto = async (fotoId, veiculoId) => {
    if (!confirm('Deseja excluir esta foto?')) return;
    try {
        await api(`/veiculos/fotos/${fotoId}`, { method: 'DELETE' });
        toast('Foto excluída.');
        loadGalleryPhotos(veiculoId);
        loadVeiculos();
    } catch (e) {
        toast('Erro ao excluir foto: ' + e.message, 'error');
    }
};

document.getElementById('modalFotosClose').addEventListener('click', () => {
    document.getElementById('modalFotosVeiculo').classList.add('hidden');
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
    }, 30000);
}

// ─── Boot ──────────────────────────────────────────────────────
checkAuth();
