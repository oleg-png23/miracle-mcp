const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'content', 'site-adapters.js'), 'utf8');
const context = { globalThis: {}, document: {}, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
vm.runInNewContext(source, context);
const registry = context.globalThis.MiraclesSiteAdapters;
assert.equal(registry.normalizeHost('www.notion.com'), 'notion.so');
assert.equal(registry.forHost('www.notion.so'), registry.forHost('notion.so'));
assert.ok(registry.forHost('app.clickup.com'));
assert.equal(registry.forHost('clickup.com'), null);

function fixture({ label = '', placeholder = '', testId = '', role = '', user = false, hidden = false, editor = false, inAI = false } = {}) {
  const node = {
    isConnected: true,
    readOnly: false,
    disabled: false,
    editor,
    parentElement: null,
    getBoundingClientRect() { return { width: 200, height: 30 }; },
    getAttribute(name) {
      return ({ 'aria-label': label, placeholder, 'data-testid': testId,
        'data-message-author-role': role, 'data-role': role })[name] || null;
    },
    matches(selector) {
      if (selector.includes('textarea')) return editor;
      return user && /data-testid\*="user"|data-role="user"|data-message-author-role="user"/.test(selector);
    },
    closest(selector) {
      if (selector.includes('aria-hidden') && hidden) return this;
      if (selector === 'form' || selector === '[role="dialog"]') return null;
      if (/notion ai|clickup brain|brain chat|ai chat/i.test(selector) && (inAI || /ai-chat|brain/i.test(testId) || /ask\s+(?:notion\s+)?ai|ask\s+brain/i.test(`${label} ${placeholder}`))) return this;
      if (/data-testid\*="user"|data-role="user"|data-message-author-role="user"/i.test(selector) && user) return this;
      return null;
    }
  };
  return node;
}

function rootWith(nodes) {
  return { querySelectorAll(selector) {
    // The real selectors must explicitly bind discovery to AI-specific labels or containers.
    if (selector.includes('textarea') || selector.includes('contenteditable') || selector.includes('role="textbox"')) {
      assert.match(selector, /ask ai|ask brain|ai-chat|brain/i);
      return nodes.filter(n => n.matches('textarea') || n.editor);
    }
    return nodes.filter(n => /assistant|response/i.test(n.getAttribute('data-testid') || '') || n.getAttribute('data-message-author-role') === 'assistant');
  } };
}

for (const hostname of ['notion.so', 'www.notion.so', 'notion.com', 'www.notion.com', 'app.clickup.com']) {
  const adapter = registry.forHost(hostname);
  assert.ok(adapter, `${hostname} resolves to an adapter`);
  const ordinaryDocEditor = fixture({ editor: true, testId: 'document-editor' });
  const aiComposer = fixture({ editor: true, testId: hostname.includes('clickup') ? 'brain-chat-input' : 'ai-chat-input', inAI: true });
  const askAIComposer = fixture({ editor: true, placeholder: hostname.includes('clickup') ? 'Ask Brain anything' : 'Ask AI anything' });
  const root = rootWith([ordinaryDocEditor, aiComposer, askAIComposer]);
  assert.equal(adapter.findComposer(root), aiComposer, `${hostname} ignores the regular document editor`);
  assert.equal(adapter.scope(aiComposer), aiComposer);
  assert.equal(adapter.scope(ordinaryDocEditor), null);
  assert.equal(adapter.diagnose(root), null);
  assert.equal(adapter.diagnose(rootWith([ordinaryDocEditor])), 'AI_CHAT_NOT_OPEN_OR_UNLABELED');

  const aiAnswer = fixture({ testId: hostname.includes('clickup') ? 'brain-response' : 'ai-response', inAI: true });
  const userMessage = fixture({ testId: 'ai-response-user-turn', role: 'user', user: true, inAI: true });
  const normalAssistant = fixture({ testId: 'assistant-message' });
  const answers = adapter.assistantNodes(rootWith([aiAnswer, userMessage, normalAssistant]));
  assert.ok(answers.includes(aiAnswer));
  assert.ok(!answers.includes(userMessage));
  assert.ok(!answers.includes(normalAssistant), `${hostname} excludes assistant-shaped messages outside AI scope`);
}

console.log('Site adapter fixture checks passed.');
