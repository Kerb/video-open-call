// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

function setupHTML() {
  document.body.innerHTML = `
    <div id="reconnecting-overlay" style="display:none">
      <div class="reconnecting-content">
        <div class="spinner"></div>
        <p>Потеряно соединение</p>
        <p class="reconnecting-hint" id="reconnect-status">
          Попытка переподключения...
        </p>
        <div class="reconnect-buttons">
          <button id="btn-retry-reconnect" class="btn btn-secondary">
            Повторить попытку
          </button>
          <button id="btn-leave-reconnect" class="btn btn-secondary btn-danger">
            Выйти из комнаты
          </button>
        </div>
      </div>
    </div>

    <div id="peer-reconnecting-indicator" style="display:none">
      <p>Собеседник временно отключился</p>
      <p class="hint">Ожидание переподключения...</p>
      <button id="btn-leave-peer-reconnect" class="btn btn-secondary btn-danger">
        Выйти из комнаты
      </button>
    </div>
  `;
}

function showReconnectingOverlay() {
  hidePeerWaitingOverlay();
  document.getElementById('reconnecting-overlay').style.display = 'flex';
}

function hideReconnectingOverlay() {
  document.getElementById('reconnecting-overlay').style.display = 'none';
}

function showPeerWaitingOverlay() {
  hideReconnectingOverlay();
  document.getElementById('peer-reconnecting-indicator').style.display = 'flex';
}

function hidePeerWaitingOverlay() {
  document.getElementById('peer-reconnecting-indicator').style.display = 'none';
}

function updateReconnectStatus(text) {
  const el = document.getElementById('reconnect-status');
  if (el) el.textContent = text;
}

describe('Reconnect UI', () => {
  beforeEach(() => {
    setupHTML();
  });

  describe('DOM elements', () => {
    it('should have reconnecting-overlay with required elements', () => {
      const overlay = document.getElementById('reconnecting-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay.style.display).toBe('none');

      expect(document.getElementById('btn-retry-reconnect')).not.toBeNull();
      expect(document.getElementById('btn-retry-reconnect').textContent).toContain('Повторить попытку');

      expect(document.getElementById('btn-leave-reconnect')).not.toBeNull();
      expect(document.getElementById('btn-leave-reconnect').textContent).toContain('Выйти из комнаты');

      expect(document.getElementById('reconnect-status')).not.toBeNull();
      expect(document.getElementById('reconnect-status').textContent.trim()).toBe('Попытка переподключения...');
    });

    it('should have peer-reconnecting-indicator with leave button', () => {
      const indicator = document.getElementById('peer-reconnecting-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator.style.display).toBe('none');

      expect(document.getElementById('btn-leave-peer-reconnect')).not.toBeNull();
      expect(document.getElementById('btn-leave-peer-reconnect').textContent).toContain('Выйти из комнаты');
    });
  });

  describe('showReconnectingOverlay', () => {
    it('should show reconnecting overlay', () => {
      showReconnectingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('flex');
    });

    it('should hide peer waiting overlay when showing reconnecting overlay', () => {
      document.getElementById('peer-reconnecting-indicator').style.display = 'flex';
      showReconnectingOverlay();
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');
    });
  });

  describe('hideReconnectingOverlay', () => {
    it('should hide reconnecting overlay', () => {
      document.getElementById('reconnecting-overlay').style.display = 'flex';
      hideReconnectingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
    });
  });

  describe('showPeerWaitingOverlay', () => {
    it('should show peer waiting indicator', () => {
      showPeerWaitingOverlay();
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('flex');
    });

    it('should hide reconnecting overlay when showing peer waiting indicator', () => {
      document.getElementById('reconnecting-overlay').style.display = 'flex';
      showPeerWaitingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
    });
  });

  describe('hidePeerWaitingOverlay', () => {
    it('should hide peer waiting indicator', () => {
      document.getElementById('peer-reconnecting-indicator').style.display = 'flex';
      hidePeerWaitingOverlay();
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');
    });
  });

  describe('show/hide mutual exclusion', () => {
    it('should switch from reconnecting overlay to peer waiting overlay', () => {
      document.getElementById('reconnecting-overlay').style.display = 'flex';
      showPeerWaitingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('flex');
    });

    it('should switch from peer waiting overlay to reconnecting overlay', () => {
      document.getElementById('peer-reconnecting-indicator').style.display = 'flex';
      showReconnectingOverlay();
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('flex');
    });
  });

  describe('updateReconnectStatus', () => {
    it('should update status text', () => {
      updateReconnectStatus('Попытка 3/5...');
      expect(document.getElementById('reconnect-status').textContent).toBe('Попытка 3/5...');
    });

    it('should not throw if element is missing', () => {
      document.getElementById('reconnect-status').remove();
      expect(() => updateReconnectStatus('test')).not.toThrow();
    });
  });

  describe('overlay states', () => {
    it('should start with both overlays hidden', () => {
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');
    });

    it('should never show both overlays simultaneously', () => {
      showReconnectingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('flex');
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');

      showPeerWaitingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('flex');

      hidePeerWaitingOverlay();
      expect(document.getElementById('reconnecting-overlay').style.display).toBe('none');
      expect(document.getElementById('peer-reconnecting-indicator').style.display).toBe('none');
    });
  });

  describe('button existence for both parties', () => {
    it('should have reconnect button for disconnected user', () => {
      const retryBtn = document.getElementById('btn-retry-reconnect');
      expect(retryBtn).not.toBeNull();
      expect(retryBtn.classList.contains('btn-secondary')).toBe(true);
    });

    it('should have leave button for disconnected user', () => {
      const leaveBtn = document.getElementById('btn-leave-reconnect');
      expect(leaveBtn).not.toBeNull();
      expect(leaveBtn.classList.contains('btn-danger')).toBe(true);
    });

    it('should have leave button for waiting peer', () => {
      const leavePeerBtn = document.getElementById('btn-leave-peer-reconnect');
      expect(leavePeerBtn).not.toBeNull();
      expect(leavePeerBtn.classList.contains('btn-danger')).toBe(true);
    });
  });
});
