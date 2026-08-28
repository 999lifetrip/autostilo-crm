const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3100;
const JWT_SECRET = process.env.JWT_SECRET || 'autostilo_crm_secret_2026';
const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'https://evolution.omelhorvendedoronline.com.br';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';

// ─── Postgres Connection Manager with Multi-Host Fallback ───────────────────
let dbConnected = false;
let dbError = null;
let activePool = null;
let activeHost = null;

const candidateHosts = [
    process.env.DB_HOST,
    '172.17.0.1',
    '187.127.0.79',
    'host.docker.internal',
    'postgresql',
    'postgres',
].filter(Boolean);

async function tryConnectHost(host) {
    console.log(`🔌 Testando conexão com Postgres em ${host}:5432...`);
    const pool = new Pool({
        host,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'n8n',
        user: process.env.DB_USER || 'n8n',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 4000,
    });

    try {
        await pool.query('SELECT 1');
        return pool;
    } catch (e) {
        await pool.end().catch(() => {});
        throw e;
    }
}

async function initTables() {
    let pool = null;
    let lastErr = null;

    for (const host of candidateHosts) {
        try {
            pool = await tryConnectHost(host);
            activeHost = host;
            activePool = pool;
            break;
        } catch (e) {
            lastErr = `${host}: ${e.message}`;
            console.log(`  ❌ Falha em ${host}: ${e.message}`);
        }
    }

    if (!pool) {
        dbConnected = false;
        dbError = lastErr;
        console.error('⚠️ Nenhum host do Postgres respondeu. Tentando novamente em 10s...');
        setTimeout(initTables, 10000);
        return;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS crm_lojas (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                slug VARCHAR(50) UNIQUE NOT NULL,
                criado_em TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS crm_usuarios (
                id SERIAL PRIMARY KEY,
                loja_id INTEGER REFERENCES crm_lojas(id),
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                senha_hash VARCHAR(200) NOT NULL,
                role VARCHAR(20) DEFAULT 'vendedor',
                ativo BOOLEAN DEFAULT true,
                criado_em TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS crm_leads (
                id SERIAL PRIMARY KEY,
                loja_id INTEGER REFERENCES crm_lojas(id),
                telefone VARCHAR(30) UNIQUE NOT NULL,
                nome VARCHAR(150),
                ia_ativa BOOLEAN DEFAULT true,
                etiqueta VARCHAR(50) DEFAULT 'novo',
                vendedor_id INTEGER REFERENCES crm_usuarios(id),
                anotacoes TEXT,
                ultima_mensagem TEXT,
                ultima_interacao TIMESTAMP DEFAULT NOW(),
                total_mensagens INTEGER DEFAULT 0,
                escalado_em TIMESTAMP,
                criado_em TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS crm_historico_leads (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES crm_leads(id),
                campo VARCHAR(50),
                valor_anterior TEXT,
                valor_novo TEXT,
                usuario_id INTEGER REFERENCES crm_usuarios(id),
                criado_em TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log(`✅ Tabelas CRM verificadas/criadas no Postgres (conectado via ${activeHost})`);

        const lojas = await pool.query('SELECT id FROM crm_lojas LIMIT 1');
        if (lojas.rows.length === 0) {
            const loja = await pool.query(
                "INSERT INTO crm_lojas (nome, slug) VALUES ('AutoStiloCar', 'autostilocar') RETURNING id"
            );
            const lojaId = loja.rows[0].id;

            const hash = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO crm_usuarios (loja_id, nome, email, senha_hash, role)
                 VALUES ($1, 'Administrador', 'admin@autostilocar.com.br', $2, 'admin')`,
                [lojaId, hash]
            );
            console.log('✅ Loja e admin padrão criados (admin@autostilocar.com.br / admin123)');
        }
        dbConnected = true;
        dbError = null;
    } catch (e) {
        dbConnected = false;
        dbError = e.message;
        console.error('⚠️ Erro ao criar tabelas:', e.message);
        setTimeout(initTables, 10000);
    }
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token necessário' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido' });
    }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        if (!dbConnected || !activePool) {
            return res.status(503).json({ error: `Banco conectando: ${dbError || 'Aguarde alguns segundos...'}` });
        }
        const { email, senha } = req.body;
        const result = await activePool.query(
            `SELECT u.*, l.nome as loja_nome, l.slug as loja_slug
             FROM crm_usuarios u
             JOIN crm_lojas l ON u.loja_id = l.id
             WHERE u.email = $1 AND u.ativo = true`,
            [email]
        );
        if (!result.rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
        const user = result.rows[0];
        const ok = await bcrypt.compare(senha, user.senha_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

        const token = jwt.sign(
            { id: user.id, lojaId: user.loja_id, role: user.role, nome: user.nome },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({
            token,
            user: { id: user.id, nome: user.nome, email: user.email, role: user.role, loja: user.loja_nome }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', authMiddleware, async (req, res) => {
    try {
        const hoje = new Date().toISOString().split('T')[0];
        const { lojaId } = req.user;

        const [totalLeads, iaAtiva, escalados, hojeCount] = await Promise.all([
            activePool.query('SELECT COUNT(*) FROM crm_leads WHERE loja_id = $1', [lojaId]),
            activePool.query('SELECT COUNT(*) FROM crm_leads WHERE loja_id = $1 AND ia_ativa = true', [lojaId]),
            activePool.query('SELECT COUNT(*) FROM crm_leads WHERE loja_id = $1 AND escalado_em IS NOT NULL AND DATE(escalado_em) = $2', [lojaId, hoje]),
            activePool.query('SELECT COUNT(*) FROM crm_leads WHERE loja_id = $1 AND DATE(ultima_interacao) = $2', [lojaId, hoje]),
        ]);

        const etiquetas = await activePool.query(
            'SELECT etiqueta, COUNT(*) as total FROM crm_leads WHERE loja_id = $1 GROUP BY etiqueta ORDER BY total DESC',
            [lojaId]
        );

        const atividade = await activePool.query(`
            SELECT DATE(ultima_interacao) as dia, COUNT(*) as total
            FROM crm_leads
            WHERE loja_id = $1 AND ultima_interacao > NOW() - INTERVAL '7 days'
            GROUP BY dia ORDER BY dia
        `, [lojaId]);

        res.json({
            total_leads: parseInt(totalLeads.rows[0].count),
            ia_ativa: parseInt(iaAtiva.rows[0].count),
            ia_off: parseInt(totalLeads.rows[0].count) - parseInt(iaAtiva.rows[0].count),
            escalados_hoje: parseInt(escalados.rows[0].count),
            ativos_hoje: parseInt(hojeCount.rows[0].count),
            etiquetas: etiquetas.rows,
            atividade: atividade.rows,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── LEADS ───────────────────────────────────────────────────────────────────
app.get('/api/leads', authMiddleware, async (req, res) => {
    try {
        const { lojaId } = req.user;
        const { busca, etiqueta, ia_ativa, vendedor_id, pagina = 1, limite = 20 } = req.query;
        const offset = (parseInt(pagina) - 1) * parseInt(limite);

        let where = ['l.loja_id = $1'];
        let params = [lojaId];
        let paramIdx = 2;

        if (busca) {
            where.push(`(l.nome ILIKE $${paramIdx} OR l.telefone ILIKE $${paramIdx})`);
            params.push(`%${busca}%`);
            paramIdx++;
        }
        if (etiqueta && etiqueta !== 'todos') {
            where.push(`l.etiqueta = $${paramIdx}`);
            params.push(etiqueta);
            paramIdx++;
        }
        if (ia_ativa !== undefined) {
            where.push(`l.ia_ativa = $${paramIdx}`);
            params.push(ia_ativa === 'true');
            paramIdx++;
        }
        if (vendedor_id) {
            where.push(`l.vendedor_id = $${paramIdx}`);
            params.push(parseInt(vendedor_id));
            paramIdx++;
        }

        const whereStr = where.join(' AND ');
        const countRes = await activePool.query(`SELECT COUNT(*) FROM crm_leads l WHERE ${whereStr}`, params);
        const leads = await activePool.query(`
            SELECT l.*, u.nome as vendedor_nome
            FROM crm_leads l
            LEFT JOIN crm_usuarios u ON l.vendedor_id = u.id
            WHERE ${whereStr}
            ORDER BY l.ultima_interacao DESC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `, [...params, parseInt(limite), offset]);

        res.json({
            leads: leads.rows,
            total: parseInt(countRes.rows[0].count),
            pagina: parseInt(pagina),
            total_paginas: Math.ceil(parseInt(countRes.rows[0].count) / parseInt(limite)),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/leads/:telefone', authMiddleware, async (req, res) => {
    try {
        const { lojaId } = req.user;
        const { telefone } = req.params;

        const lead = await activePool.query(
            `SELECT l.*, u.nome as vendedor_nome
             FROM crm_leads l LEFT JOIN crm_usuarios u ON l.vendedor_id = u.id
             WHERE l.loja_id = $1 AND l.telefone = $2`,
            [lojaId, decodeURIComponent(telefone)]
        );
        if (!lead.rows.length) return res.status(404).json({ error: 'Lead não encontrado' });

        const historico = await activePool.query(
            `SELECT * FROM n8n_historico_mensagens WHERE session_id = $1 ORDER BY id DESC LIMIT 100`,
            [decodeURIComponent(telefone)]
        ).catch(() => ({ rows: [] }));

        res.json({ lead: lead.rows[0], historico: historico.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/leads/:telefone', authMiddleware, async (req, res) => {
    try {
        const { lojaId } = req.user;
        const { telefone } = req.params;
        const { ia_ativa, etiqueta, vendedor_id, anotacoes, nome } = req.body;

        const current = await activePool.query(
            'SELECT * FROM crm_leads WHERE loja_id = $1 AND telefone = $2',
            [lojaId, decodeURIComponent(telefone)]
        );
        if (!current.rows.length) return res.status(404).json({ error: 'Lead não encontrado' });

        const lead = current.rows[0];
        const updates = [];
        const params = [];
        let idx = 1;

        const fields = { ia_ativa, etiqueta, vendedor_id, anotacoes, nome };
        for (const [key, val] of Object.entries(fields)) {
            if (val !== undefined) {
                updates.push(`${key} = $${idx}`);
                params.push(val);
                idx++;
            }
        }

        if (!updates.length) return res.json({ lead });

        params.push(lojaId, decodeURIComponent(telefone));
        const updated = await activePool.query(
            `UPDATE crm_leads SET ${updates.join(', ')} WHERE loja_id = $${idx} AND telefone = $${idx + 1} RETURNING *`,
            params
        );

        if (ia_ativa === false || ia_ativa === 'false') {
            await activePool.query(
                `UPDATE n8n_status_atendimento SET escalado = true WHERE telefone = $1`,
                [decodeURIComponent(telefone)]
            ).catch(() => {});
        }

        res.json({ lead: updated.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/leads/upsert', async (req, res) => {
    const secret = req.headers['x-crm-secret'];
    if (secret !== JWT_SECRET) return res.status(403).json({ error: 'Forbidden' });

    try {
        const { loja_slug, telefone, nome, ultima_mensagem } = req.body;

        const loja = await activePool.query('SELECT id FROM crm_lojas WHERE slug = $1', [loja_slug]);
        if (!loja.rows.length) return res.status(404).json({ error: 'Loja não encontrada' });
        const lojaId = loja.rows[0].id;

        await activePool.query(`
            INSERT INTO crm_leads (loja_id, telefone, nome, ultima_mensagem, ultima_interacao, total_mensagens)
            VALUES ($1, $2, $3, $4, NOW(), 1)
            ON CONFLICT (telefone) DO UPDATE SET
                nome = COALESCE(EXCLUDED.nome, crm_leads.nome),
                ultima_mensagem = EXCLUDED.ultima_mensagem,
                ultima_interacao = NOW(),
                total_mensagens = crm_leads.total_mensagens + 1
        `, [lojaId, telefone, nome, ultima_mensagem]);

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── WEBHOOK RECEPTOR (Evolution API -> CRM & n8n) ───────────────────────────
app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
        const body = req.body || {};
        const data = body.data || body;
        const key = data.key || {};
        
        const remoteJid = key.remoteJidAlt || key.remoteJid || '';
        if (remoteJid.includes('status@broadcast') || remoteJid.includes('@g.us')) {
            return res.json({ ignored: true });
        }

        if (key.fromMe === false) {
            const rawPhone = (key.remoteJidAlt || key.remoteJid || '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
            const pushName = data.pushName || 'Cliente WhatsApp';
            const msgText = data.message?.conversation || data.message?.extendedTextMessage?.text || (data.message?.audioMessage ? '[Áudio]' : '[Mídia]');

            if (rawPhone && activePool && dbConnected) {
                const loja = await activePool.query('SELECT id FROM crm_lojas LIMIT 1');
                const lojaId = loja.rows[0]?.id || 1;

                await activePool.query(`
                    INSERT INTO crm_leads (loja_id, telefone, nome, ultima_mensagem, ultima_interacao, total_mensagens)
                    VALUES ($1, $2, $3, $4, NOW(), 1)
                    ON CONFLICT (telefone) DO UPDATE SET
                        nome = COALESCE(crm_leads.nome, EXCLUDED.nome),
                        ultima_mensagem = EXCLUDED.ultima_mensagem,
                        ultima_interacao = NOW(),
                        total_mensagens = crm_leads.total_mensagens + 1
                `, [lojaId, rawPhone, pushName, msgText]).catch(e => console.error('Erro ao upsert lead via webhook:', e.message));
            }

            // Encaminha assincronamente para o n8n
            fetch('https://n8n.omelhorvendedoronline.com.br/webhook/5d791192-d0b2-423d-bc69-491b3b31b6ef', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).catch(e => console.error('Erro ao encaminhar para n8n:', e.message));
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('Webhook error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────
app.get('/api/usuarios', authMiddleware, async (req, res) => {
    try {
        const { lojaId } = req.user;
        const result = await activePool.query(
            'SELECT id, nome, email, role, ativo, criado_em FROM crm_usuarios WHERE loja_id = $1 ORDER BY nome',
            [lojaId]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/usuarios', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Somente admin' });
        const { lojaId } = req.user;
        const { nome, email, senha, role = 'vendedor' } = req.body;
        const hash = await bcrypt.hash(senha, 10);
        const result = await activePool.query(
            'INSERT INTO crm_usuarios (loja_id, nome, email, senha_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, role',
            [lojaId, nome, email, hash, role]
        );
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ENVIAR MENSAGEM MANUAL (via Evolution API) ───────────────────────────────
app.post('/api/leads/:telefone/mensagem', authMiddleware, async (req, res) => {
    try {
        const { telefone } = req.params;
        const { texto } = req.body;

        const phone = decodeURIComponent(telefone).replace(/\D/g, '');
        const response = await fetch(`${EVOLUTION_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_KEY,
            },
            body: JSON.stringify({
                number: `${phone}@s.whatsapp.net`,
                text: texto,
            }),
        });

        const data = await response.json();
        if (!response.ok) return res.status(400).json({ error: 'Erro ao enviar', detail: data });
        res.json({ ok: true, data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
    status: 'ok',
    db_connected: dbConnected,
    db_host: activeHost || process.env.DB_HOST,
    db_error: dbError,
    uptime: process.uptime(),
    ts: new Date().toISOString()
}));

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Start Web Server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 AutoStilo CRM rodando na porta ${PORT}`);
    initTables();
});
