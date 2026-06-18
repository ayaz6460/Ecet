/**
 * AllotIQ AI Chatbot
 * Powered by Gemini AI - answers questions strictly from the TGECET 2025 database.
 *
 * API Key is stored in localStorage (entered once by the user via a secure modal).
 * It is never sent to any server other than Google's Gemini API endpoint.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';
const LS_KEY = 'allotiq_gemini_key';

function getApiKey() {
    return localStorage.getItem(LS_KEY) || '';
}

function setApiKey(key) {
    localStorage.setItem(LS_KEY, key.trim());
}

function buildApiUrl() {
    return GEMINI_API_BASE + getApiKey();
}


// Chat state
let chatHistory = [];
let isChatOpen = false;
let dbSummary = null; // Will be built once the main DB loads

// ─── Build compact DB summary for context injection ──────────────────────────
function buildDatabaseSummary() {
    if (!window.allotments || !window.allotments.length) return null;
    if (!window.collegeDetails) return null;

    // Aggregate per college-branch combo
    const collegeMap = new Map();

    window.allotments.forEach(row => {
        const key = `${row.college_code}___${row.branch}`;
        if (!collegeMap.has(key)) {
            const detail = window.collegeDetails[row.college_code] || {};
            collegeMap.set(key, {
                code: row.college_code,
                name: row.college || detail.name || row.college_code,
                branch: row.branch,
                address: detail.address || '',
                rating: detail.rating || null,
                lat: detail.lat || null,
                lng: detail.lng || null,
                type: detail.type || '',
                opening: Infinity,
                closing: -Infinity,
                count: 0,
                male: 0,
                female: 0
            });
        }
        const entry = collegeMap.get(key);
        const rank = parseInt(row.rank, 10);
        if (!isNaN(rank)) {
            if (rank < entry.opening) entry.opening = rank;
            if (rank > entry.closing) entry.closing = rank;
        }
        entry.count++;
        if (row.gender === 'M') entry.male++;
        if (row.gender === 'F') entry.female++;
    });

    const rows = [];
    collegeMap.forEach(c => {
        rows.push(
            `${c.code}|${c.name}|${c.branch}|Opening:${c.opening === Infinity ? 'N/A' : c.opening}|Closing:${c.closing === -Infinity ? 'N/A' : c.closing}|Intake:${c.count}|Rating:${c.rating || 'N/A'}|Location:${c.address || 'N/A'}|Type:${c.type || 'Co-Education'}`
        );
    });

    return rows.join('\n');
}

// ─── Build the Gemini system prompt ──────────────────────────────────────────
function buildSystemPrompt() {
    const summary = dbSummary || '';

    return `You are AllotIQ Assistant, an expert AI chatbot integrated into the AllotIQ portal — a TGECET 2025 CSE Allotment Explorer.

Your ONLY source of truth is the TGECET 2025 allotment database provided below. You must NEVER answer from outside knowledge about colleges, ranks, or admissions not found in this dataset.

## Rules:
1. Answer ONLY from the database below. If data is missing or ambiguous, say so honestly.
2. Always be helpful, precise, and friendly.
3. For rank-based queries, compare user rank with Opening Rank and Closing Rank columns.
   - A student with rank X is ELIGIBLE if: Opening Rank >= X AND Closing Rank >= X (i.e., the college admitted students with ranks up to the Closing Rank, and at minimum from the Opening Rank).
   - Lower rank number = better rank.
4. When listing colleges, always mention: College Code, College Name, Branch, Opening Rank, Closing Rank, Rating (if available), and Location.
5. Keep answers concise but complete. Use bullet points or tables for multi-college answers.
6. Do not invent, guess, or extrapolate data beyond what is in the database.
7. When asked "which colleges can I get with rank X", filter the database for colleges where Opening Rank >= X AND Closing Rank >= X (i.e., X falls within the admitted rank range).

## TGECET 2025 CSE Allotment Database (Format: Code|Name|Branch|Opening|Closing|Intake|Rating|Location|Type):
${summary}

## End of Database

Respond naturally in English. If the user greets you, respond warmly and introduce yourself.`;
}

// ─── Send message to Gemini ───────────────────────────────────────────────────
async function sendToGemini(userMessage) {
    if (!dbSummary) {
        dbSummary = buildDatabaseSummary();
    }

    const systemPrompt = buildSystemPrompt();

    // Build contents array with full chat history
    const contents = [
        {
            role: 'user',
            parts: [{ text: systemPrompt + '\n\nUser: ' + userMessage }]
        }
    ];

    // For subsequent messages, add proper history
    if (chatHistory.length > 0) {
        const historyContents = [];
        chatHistory.forEach((msg, idx) => {
            if (idx === 0) {
                // First user message already contains the system prompt
                historyContents.push({ role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + msg.content }] });
            } else {
                historyContents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] });
            }
        });
        historyContents.push({ role: 'user', parts: [{ text: userMessage }] });
        contents.length = 0;
        historyContents.forEach(c => contents.push(c));
    }

    const body = {
        contents,
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            topP: 0.8
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }
        ]
    };

    const response = await fetch(buildApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
}

// ─── Format bot response (markdown-lite) ─────────────────────────────────────
function formatBotMessage(text) {
    return text
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Headings ##
        .replace(/^## (.+)$/gm, '<div class="chat-heading">$1</div>')
        // Bullet points starting with - or •
        .replace(/^[-•]\s+(.+)$/gm, '<div class="chat-bullet">$1</div>')
        // Numbered lists
        .replace(/^\d+\.\s+(.+)$/gm, '<div class="chat-numbered">$1</div>')
        // Code
        .replace(/`([^`]+)`/g, '<code class="chat-code">$1</code>')
        // Line breaks
        .replace(/\n/g, '<br>');
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function appendMessage(role, content, isLoading = false) {
    const messagesDiv = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message chat-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    if (isLoading) {
        bubble.innerHTML = `<div class="chat-typing-dots"><span></span><span></span><span></span></div>`;
        msgDiv.id = 'chatLoadingMsg';
    } else if (role === 'bot') {
        bubble.innerHTML = formatBotMessage(content);
    } else {
        bubble.textContent = content;
    }

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = role === 'bot' ? '🤖' : '👤';

    if (role === 'bot') {
        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
    } else {
        msgDiv.appendChild(bubble);
        msgDiv.appendChild(avatar);
    }

    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv;
}

function removeLoadingMessage() {
    const loading = document.getElementById('chatLoadingMsg');
    if (loading) loading.remove();
}

function setInputDisabled(disabled) {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (input) input.disabled = disabled;
    if (btn) btn.disabled = disabled;
}

// ─── Handle user send ─────────────────────────────────────────────────────────
async function handleChatSend() {
    const input = document.getElementById('chatInput');
    const userText = input.value.trim();
    if (!userText) return;

    // Ensure API key is set
    if (!getApiKey()) {
        showApiKeyModal();
        return;
    }

    // Reset input
    input.value = '';
    input.style.height = 'auto';

    // Append user message
    appendMessage('user', userText);
    chatHistory.push({ role: 'user', content: userText });

    // Show typing indicator
    setInputDisabled(true);
    appendMessage('bot', '', true);

    try {
        const reply = await sendToGemini(userText);
        removeLoadingMessage();
        appendMessage('bot', reply);
        chatHistory.push({ role: 'model', content: reply });
    } catch (err) {
        removeLoadingMessage();
        appendMessage('bot', `⚠️ Sorry, I couldn't reach the AI. Please check your connection and try again.\n\nError: ${err.message}`);
        console.error('Gemini error:', err);
    } finally {
        setInputDisabled(false);
        document.getElementById('chatInput')?.focus();
    }
}

// ─── Toggle chat panel ────────────────────────────────────────────────────────
function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const fab = document.getElementById('chatFab');
    isChatOpen = !isChatOpen;

    if (isChatOpen) {
        panel.classList.add('chat-open');
        fab.classList.add('chat-fab-active');

        // If no API key, show the key modal on first open
        if (!getApiKey()) {
            setTimeout(showApiKeyModal, 350);
        } else {
            document.getElementById('chatInput')?.focus();
        }

        // Show welcome message on first open
        const msgs = document.getElementById('chatMessages');
        if (msgs && msgs.children.length === 0) {
            appendMessage('bot', "👋 Hi! I'm **AllotIQ Assistant**, your AI guide for TGECET 2025 admissions.\n\nI can answer questions like:\n- Which colleges can I get with rank **3200**?\n- What is the closing rank of **VBIT** for CSC?\n- List **top-rated** colleges in Hyderabad.\n- What branches does **CBIT** offer?\n\nWhat would you like to know? 🎓");
        }
    } else {
        panel.classList.remove('chat-open');
        fab.classList.remove('chat-fab-active');
    }
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
function sendSuggestion(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        handleChatSend();
    }
}

// ─── Clear chat ───────────────────────────────────────────────────────────────
function clearChat() {
    chatHistory = [];
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.innerHTML = '';
    appendMessage('bot', "🔄 Chat cleared! Ask me anything about TGECET 2025 colleges and allotments.");
}

// ─── Initialize chatbot UI ───────────────────────────────────────────────────
function initChatbot() {
    // Build DB summary as soon as possible
    setTimeout(() => {
        dbSummary = buildDatabaseSummary();
        console.log(`[AllotIQ AI] DB summary built with ${dbSummary ? dbSummary.split('\n').length : 0} college-branch entries.`);
    }, 2000);

    const chatHTML = `
    <!-- Chatbot FAB Button -->
    <button class="chat-fab" id="chatFab" onclick="toggleChat()" title="Ask AllotIQ AI" aria-label="Open AI Chatbot">
        <span class="chat-fab-icon-default">
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>
            </svg>
        </span>
        <span class="chat-fab-icon-close" style="display:none;">
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </span>
        <span class="chat-fab-badge">AI</span>
    </button>

    <!-- Chat Panel -->
    <div class="chat-panel" id="chatPanel">
        <!-- Header -->
        <div class="chat-header">
            <div class="chat-header-info">
                <div class="chat-header-avatar">🤖</div>
                <div>
                    <div class="chat-header-name">AllotIQ Assistant</div>
                    <div class="chat-header-status">
                        <span class="chat-status-dot"></span>
                        Powered by Gemini AI · 2025 Data
                    </div>
                </div>
            </div>
            <div class="chat-header-actions">
                <button class="chat-action-btn" onclick="showApiKeyModal()" title="Set Gemini API Key">
                    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
                    </svg>
                </button>
                <button class="chat-action-btn" onclick="clearChat()" title="Clear chat">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                </button>
                <button class="chat-action-btn" onclick="toggleChat()" title="Close chat">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Suggestion Chips -->
        <div class="chat-suggestions" id="chatSuggestions">
            <button class="chat-chip" onclick="sendSuggestion('Which colleges can I get with rank 3000 for CSE?')">🎯 Rank 3000</button>
            <button class="chat-chip" onclick="sendSuggestion('List top 5 rated colleges in the database')">⭐ Top Colleges</button>
            <button class="chat-chip" onclick="sendSuggestion('What is the closing rank of VBIT?')">🏛️ VBIT cutoff</button>
            <button class="chat-chip" onclick="sendSuggestion('Which colleges are women only?')">👩‍🎓 Women Only</button>
            <button class="chat-chip" onclick="sendSuggestion('Colleges in Hyderabad with rating above 4')">📍 Hyderabad</button>
        </div>

        <!-- Messages Area -->
        <div class="chat-messages" id="chatMessages"></div>

        <!-- Input Area -->
        <div class="chat-input-area">
            <textarea
                id="chatInput"
                class="chat-textarea"
                placeholder="Ask about colleges, cutoffs, ranks…"
                rows="1"
                onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); handleChatSend(); }"
                oninput="this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,120)+'px';"
            ></textarea>
            <button class="chat-send-btn" id="chatSendBtn" onclick="handleChatSend()" title="Send message" aria-label="Send">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
            </button>
        </div>
        <div class="chat-footer-note">AllotIQ AI · TGECET 2025 data only</div>
    </div>`;

    // Inject into body
    const wrapper = document.createElement('div');
    wrapper.id = 'chatbotRoot';
    wrapper.innerHTML = chatHTML;
    document.body.appendChild(wrapper);

    // FAB icon toggle on open/close
    const fabDefault = wrapper.querySelector('.chat-fab-icon-default');
    const fabClose = wrapper.querySelector('.chat-fab-icon-close');
    const originalToggle = window.toggleChat;
    window.toggleChat = function () {
        originalToggle();
        fabDefault.style.display = isChatOpen ? 'none' : 'flex';
        fabClose.style.display = isChatOpen ? 'flex' : 'none';
    };
}

// ─── API Key Modal ────────────────────────────────────────────────────────────
function showApiKeyModal() {
    // Remove existing modal if any
    const existing = document.getElementById('apiKeyModal');
    if (existing) existing.remove();

    const hasKey = !!getApiKey();
    const modal = document.createElement('div');
    modal.id = 'apiKeyModal';
    modal.innerHTML = `
    <div class="akim-overlay" onclick="document.getElementById('apiKeyModal').remove()">
    </div>
    <div class="akim-box">
        <div class="akim-icon">🔑</div>
        <h3 class="akim-title">Gemini API Key</h3>
        <p class="akim-desc">
            AllotIQ AI uses <strong>Google Gemini</strong> to answer questions from the TGECET 2025 database.
            Your key is stored only in your browser's localStorage and is never shared.
        </p>
        <input
            id="apiKeyInput"
            class="akim-input"
            type="password"
            placeholder="Paste your Gemini API key here…"
            value="${hasKey ? getApiKey() : ''}"
            autocomplete="off"
        />
        <div class="akim-actions">
            <button class="akim-btn akim-btn-cancel" onclick="document.getElementById('apiKeyModal').remove()">
                Cancel
            </button>
            ${hasKey ? '<button class="akim-btn akim-btn-remove" onclick="clearApiKey()">Remove Key</button>' : ''}
            <button class="akim-btn akim-btn-save" onclick="saveApiKey()">
                Save &amp; Continue
            </button>
        </div>
        <p class="akim-hint">Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a></p>
    </div>`;
    document.body.appendChild(modal);
    setTimeout(() => {
        modal.querySelector('.akim-box').style.transform = 'scale(1) translateY(0)';
        modal.querySelector('.akim-box').style.opacity = '1';
        document.getElementById('apiKeyInput')?.focus();
    }, 10);
}

function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const key = input?.value?.trim();
    if (!key) {
        input.style.borderColor = '#ef4444';
        input.placeholder = 'API key cannot be empty!';
        return;
    }
    setApiKey(key);
    document.getElementById('apiKeyModal')?.remove();
    appendMessage('bot', '✅ **API key saved!** You can now ask me anything about TGECET 2025 colleges and admissions.');
    document.getElementById('chatInput')?.focus();
}

function clearApiKey() {
    localStorage.removeItem(LS_KEY);
    document.getElementById('apiKeyModal')?.remove();
    appendMessage('bot', '🗑️ API key removed. Click the 🔑 icon in the header to add a new key.');
}

// Inject API Key modal styles
(function injectApiKeyStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #apiKeyModal {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .akim-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px);
        }
        .akim-box {
            position: relative;
            z-index: 1;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 2rem 2rem 1.5rem;
            max-width: 400px;
            width: calc(100% - 2rem);
            box-shadow: 0 25px 60px rgba(0,0,0,0.5), 0 8px 24px rgba(99,102,241,0.2);
            transform: scale(0.9) translateY(20px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.34,1.3,0.64,1);
            text-align: center;
        }
        .akim-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
        .akim-title {
            font-size: 1.25rem;
            font-weight: 800;
            color: var(--text-primary);
            margin-bottom: 0.6rem;
        }
        .akim-desc {
            font-size: 0.82rem;
            color: var(--text-secondary);
            line-height: 1.55;
            margin-bottom: 1.25rem;
        }
        .akim-desc strong { color: var(--accent-primary); }
        .akim-input {
            width: 100%;
            background: var(--bg-input);
            border: 1.5px solid var(--border-color);
            border-radius: 10px;
            color: var(--text-primary);
            padding: 0.7rem 1rem;
            font-size: 0.875rem;
            font-family: 'Outfit', monospace;
            outline: none;
            margin-bottom: 1.25rem;
            transition: border-color 0.2s;
        }
        .akim-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        .akim-actions {
            display: flex;
            gap: 0.6rem;
            justify-content: center;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }
        .akim-btn {
            padding: 0.55rem 1.25rem;
            border-radius: 10px;
            font-size: 0.875rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }
        .akim-btn-cancel {
            background: var(--bg-input);
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
        }
        .akim-btn-cancel:hover { color: var(--text-primary); background: var(--bg-surface-hover); }
        .akim-btn-remove {
            background: rgba(239,68,68,0.1);
            color: #ef4444;
            border: 1px solid rgba(239,68,68,0.2);
        }
        .akim-btn-remove:hover { background: rgba(239,68,68,0.2); }
        .akim-btn-save {
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            color: #fff;
            box-shadow: 0 4px 14px rgba(99,102,241,0.35);
        }
        .akim-btn-save:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99,102,241,0.45); }
        .akim-hint {
            font-size: 0.72rem;
            color: var(--text-muted);
        }
        .akim-hint a { color: var(--accent-secondary); text-decoration: underline; }
    `;
    document.head.appendChild(style);
}());

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatbot);
} else {
    initChatbot();
}
