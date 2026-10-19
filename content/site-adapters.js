/* Conservative adapters for products that mix AI chat with editable work items.
 * Selectors intentionally require AI-specific labels/containers. If the AI chat
 * is closed or its accessible names change, discovery returns no editor. */
(() => {
  'use strict';

  const normalizeHost = hostname => {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return host === 'notion.com' ? 'notion.so' : host;
  };

  const notionEditor = [
    '[data-testid*="ai-chat" i] textarea:not([readonly]):not([disabled])',
    '[data-testid*="ai-chat" i] [contenteditable="true"]',
    '[role="dialog"] textarea[placeholder*="ask ai" i]',
    '[role="dialog"] [contenteditable="true"][aria-label*="ask ai" i]',
    'textarea[placeholder*="ask ai" i]',
    '[contenteditable="true"][aria-label*="ask ai" i]',
    '[role="textbox"][aria-label*="ask ai" i]'
  ].join(',');
  const clickupEditor = [
    '[data-testid*="brain" i] textarea:not([readonly]):not([disabled])',
    '[data-testid*="brain" i] [contenteditable="true"]',
    '[role="dialog"] textarea[placeholder*="ask brain" i]',
    '[role="dialog"] textarea[placeholder*="ask ai" i]',
    'textarea[placeholder*="ask brain" i]',
    'textarea[placeholder*="ask ai" i]',
    '[contenteditable="true"][aria-label*="ask brain" i]',
    '[contenteditable="true"][aria-label*="ask ai" i]',
    '[role="textbox"][aria-label*="ask brain" i]',
    '[role="textbox"][aria-label*="ask ai" i]'
  ].join(',');

  const notionResponses = [
    '[data-testid*="ai-response" i]',
    '[data-testid*="assistant-message" i]',
    '[data-message-author-role="assistant"]'
  ].join(',');
  const clickupResponses = [
    '[data-testid*="brain-response" i]',
    '[data-testid*="ai-response" i]',
    '[data-testid*="assistant-message" i]',
    '[data-message-author-role="assistant"]'
  ].join(',');

  function aiContainer(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest([
      '[data-testid*="ai-chat" i]', '[data-testid*="brain" i]',
      '[aria-label*="notion ai" i]', '[aria-label*="clickup brain" i]',
      '[aria-label*="brain chat" i]', '[aria-label*="ai chat" i]'
    ].join(','));
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.closest('[aria-hidden="true"], [inert]')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 70 && rect.height > 14 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function composerScope(composer) {
    const container = aiContainer(composer);
    if (container) return container;
    const label = [composer?.getAttribute?.('placeholder'), composer?.getAttribute?.('aria-label')].join(' ');
    if (!/ask\s+(?:notion\s+)?ai|ask\s+brain/i.test(label)) return null;
    return composer.closest('form') || composer.closest('[role="dialog"]') || composer.parentElement || null;
  }

  function findComposer(adapter, root = document) {
    return [...root.querySelectorAll(adapter.editor)].find(el =>
      isVisible(el) &&
      (!el.matches('textarea') || (!el.readOnly && !el.disabled)) &&
      (aiContainer(el) || /ask\s+(?:notion\s+)?ai|ask\s+brain/i.test(
        [el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ')
      ))
    ) || null;
  }

  function assistantNodes(adapter, root = document) {
    return [...root.querySelectorAll(adapter.reader.selectors)].filter(el => {
      if (!aiContainer(el) || el.closest('[aria-hidden="true"], [inert],[data-role="user" i],[data-message-author-role="user" i],[data-testid*="user-message" i],.user-message,.human-message')) return false;
      const role = (el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || '').toLowerCase();
      if (role && !['assistant', 'model', 'ai'].includes(role)) return false;
      return !el.matches('[data-testid*="user" i], [data-role="user" i], [data-message-author-role="user" i]');
    });
  }

  const adapters = {
    'notion.so': {
      editor: notionEditor,
      reader: { selectors: notionResponses, exclude: '[data-testid*="thinking" i]', send: 'button[aria-label*="send" i],button[aria-label*="submit" i]', stop: 'button[aria-label*="stop" i]' },
      findComposer(root) { return findComposer(this, root); },
      scope(composer) { return composerScope(composer); },
      assistantNodes(root) { return assistantNodes(this, root); },
      errorMessage: 'Open Notion AI chat: AI_CHAT_NOT_OPEN_OR_UNLABELED',
      diagnose(root = document) { return this.findComposer(root) ? null : 'AI_CHAT_NOT_OPEN_OR_UNLABELED'; }
    },
    'app.clickup.com': {
      editor: clickupEditor,
      reader: { selectors: clickupResponses, exclude: '[data-testid*="thinking" i], [data-testid*="reasoning" i]', send: 'button[aria-label*="send" i],button[aria-label*="submit" i]', stop: 'button[aria-label*="stop" i]' },
      findComposer(root) { return findComposer(this, root); },
      scope(composer) { return composerScope(composer); },
      assistantNodes(root) { return assistantNodes(this, root); },
      errorMessage: 'Open ClickUp Brain Chat: AI_CHAT_NOT_OPEN_OR_UNLABELED',
      diagnose(root = document) { return this.findComposer(root) ? null : 'AI_CHAT_NOT_OPEN_OR_UNLABELED'; }
    }
  };

  const registry = Object.assign({}, adapters);
  Object.defineProperties(registry, {
    normalizeHost: { value: normalizeHost },
    forHost: { value(hostname) { return registry[normalizeHost(hostname)] || null; } }
  });
  globalThis.MiraclesSiteAdapters = Object.freeze(registry);
})();
