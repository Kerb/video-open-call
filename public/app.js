const { STATE, STATE_TRANSITIONS } = window;

const state = {
  appState: STATE.HOME,
  socket: null,
  localStream: null,
  peerConnection: null,
  roomCode: null,
  isRoomCreator: false,
  pendingStartWebRTC: false,
  pendingOffer: null,
  chatUnread: 0,
  isScreenSharing: false,
  savedCameraTrack: null,
  screenStream: null,
  uuid: getOrCreateUUID(),
  isReconnecting: false,
  waitingForPeerReconnect: false,
};

const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

const retryState = {
  attempt: 0,
  timer: null,
};

function transition(newState) {
  const allowed = STATE_TRANSITIONS[state.appState];
  if (!allowed || !allowed.includes(newState)) {
    console.warn(`Invalid transition: ${state.appState} → ${newState}`);
    return false;
  }
  state.appState = newState;
  console.log(`State: ${newState}`);
  return true;
}

const $ = (id) => document.getElementById(id);

const screens = {
  home: () => showScreen('home-screen'),
  room: () => showScreen('room-screen'),
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.style.display = el.id === id ? 'flex' : 'none';
  });
}

function showNotification(message, type) {
  const el = $('notification');
  el.textContent = message;
  el.className = `notification ${type}`;
  el.style.display = 'block';
  if (window.notificationTimeout) clearTimeout(window.notificationTimeout);
  window.notificationTimeout = setTimeout(() => {
    el.style.display = 'none';
  }, 5000);
}

function hideNotification() {
  $('notification').style.display = 'none';
}

function showReconnectingOverlay() {
  hidePeerWaitingOverlay();
  $('reconnecting-overlay').style.display = 'flex';
}

function hideReconnectingOverlay() {
  $('reconnecting-overlay').style.display = 'none';
}

function showPeerWaitingOverlay() {
  hideReconnectingOverlay();
  $('peer-reconnecting-indicator').style.display = 'flex';
}

function hidePeerWaitingOverlay() {
  $('peer-reconnecting-indicator').style.display = 'none';
}

function getOrCreateUUID() {
  const key = 'call-uuid';
  let uuid = localStorage.getItem(key);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(key, uuid);
  }
  return uuid;
}

/* ===================================================== */
/* SOCKET.IO                                             */
/* ===================================================== */

function connectSocket() {
  state.socket = io({
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  });

  state.socket.on('connect', () => {
    console.log('Socket connected');
  });

  state.socket.on('disconnect', () => {
    console.log('Socket disconnected');
    clearTimeout(state.pcFailTimer);
    if (state.roomCode && [STATE.IN_CALL, STATE.CONNECTING, STATE.WAITING, STATE.DISCONNECTED].includes(state.appState)) {
      state.isReconnecting = true;
      transition(STATE.DISCONNECTED);
      showReconnectingOverlay();
      scheduleRetry();
    } else if (state.appState !== STATE.HOME) {
      showNotification('Потеря соединения с сервером', 'error');
    }
  });

  state.socket.on('reconnect_attempt', () => {
    console.log('Reconnecting...');
  });

  state.socket.on('reconnect', () => {
    console.log('Reconnected');
    if (state.isReconnecting && state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    }
  });

  state.socket.on('reconnect-success', ({ code, isCreator }) => {
    state.isReconnecting = false;
    retryState.attempt = 0;
    clearTimeout(retryState.timer);
    hideReconnectingOverlay();
    hideNotification();
    transition(STATE.CONNECTING);

    state.isRoomCreator = isCreator;
    restartIce();
  });

  /* Room events */
  state.socket.on('room-created', ({ code }) => {
    state.roomCode = code;
    state.isRoomCreator = true;
    transition(STATE.WAITING);
    enterRoom(code);
  });

  state.socket.on('room-joined', ({ code }) => {
    state.roomCode = code;
    state.isRoomCreator = false;
    transition(STATE.WAITING);
    enterRoom(code);
  });

  state.socket.on('user-joined', () => {
    showNotification('Пользователь подключился', 'success');
    transition(STATE.CONNECTING);
    if (state.socket && state.localStream) {
      const audioTrack = state.localStream.getAudioTracks()[0];
      if (audioTrack && !audioTrack.enabled) {
        state.socket.emit('audio-state-change', { muted: true });
      }
    }
    if (state.localStream) {
      startWebRTC(true);
    } else {
      state.pendingStartWebRTC = true;
    }
  });

  state.socket.on('offer', ({ sdp }) => {
    try {
      transition(STATE.CONNECTING);
      if (state.localStream) {
        handleOffer(sdp);
      } else {
        state.pendingOffer = sdp;
      }
    } catch (err) {
      console.error('Error handling offer:', err);
      showNotification('Ошибка обработки входящего звонка', 'error');
    }
  });

  state.socket.on('answer', ({ sdp }) => {
    try {
      handleAnswer(sdp);
    } catch (err) {
      console.error('Error handling answer:', err);
      showNotification('Ошибка обработки ответа', 'error');
    }
  });

  state.socket.on('ice-candidate', ({ candidate }) => {
    try {
      handleIceCandidate(candidate);
    } catch (err) {
      console.error('Error handling ICE candidate:', err);
    }
  });

  state.socket.on('peer-disconnected', ({ canReconnect }) => {
    clearTimeout(state.pcFailTimer);
    if (canReconnect) {
      state.waitingForPeerReconnect = true;
      transition(STATE.DISCONNECTED);
      showPeerWaitingOverlay();
    } else {
      showNotification('Собеседник отключился', 'info');
      endCall();
      screens.home();
    }
  });

  state.socket.on('room-not-found', () => {
    if (state.isReconnecting) {
      state.isReconnecting = false;
      hideReconnectingOverlay();
      showNotification('Комната больше не доступна', 'error');
      endCall();
      screens.home();
      return;
    }
    showModalError('Комната не найдена');
    enableJoinButton();
  });

  state.socket.on('room-full', () => {
    showModalError('Комната переполнена (максимум 2 участника)');
    enableJoinButton();
  });

  state.socket.on('room-error', ({ message }) => {
    showNotification(message, 'error');
  });

  state.socket.on('chat-message', ({ text }) => {
    addChatMessage(text, false);
    const panel = $('chat-panel');
    if (panel.style.display === 'none') {
      state.chatUnread++;
      updateChatBadge();
      showChatToast(text);
    }
  });

  state.socket.on('audio-state-change', ({ muted }) => {
    $('remote-mute-indicator').style.display = muted ? 'flex' : 'none';
  });

  state.socket.on('screen-share-state-change', ({ active }) => {
    $('remote-screen-indicator').style.display = active ? 'flex' : 'none';
  });

  state.socket.on('peer-reconnected', () => {
    state.waitingForPeerReconnect = false;
    hidePeerWaitingOverlay();
    transition(STATE.CONNECTING);

    if (state.isRoomCreator) {
      restartIce();
    } else {
      closePeerConnection();
    }
  });

  state.socket.connect();
}

/* ===================================================== */
/* WEBRTC                                                */
/* ===================================================== */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const MEDIA_CONSTRAINTS = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: true,
};

async function getLocalMedia() {
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
    const video = $('localVideo');
    video.srcObject = state.localStream;

    state.localStream.getAudioTracks().forEach(t => t.enabled = false);
    state.localStream.getVideoTracks().forEach(t => t.enabled = false);
    $('btn-mute').dataset.active = 'false';
    $('btn-camera').dataset.active = 'false';
    $('local-placeholder').style.display = 'flex';
    video.style.display = 'none';
    return true;
  } catch (err) {
    console.error('getUserMedia error:', err);
    if (err.name === 'NotFoundError') {
      showNotification('Камера или микрофон не найдены', 'error');
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showNotification('Доступ к камере/микрофону запрещён', 'error');
    } else {
      showNotification('Ошибка доступа к медиаустройствам', 'error');
    }
    $('local-placeholder').style.display = 'flex';
    $('localVideo').style.display = 'none';
    return false;
  }
}

function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
}

function createPeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (event) => {
    if (event.candidate && state.socket && state.roomCode) {
      state.socket.emit('ice-candidate', { candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    const remoteVideo = $('remoteVideo');
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      $('remote-placeholder').style.display = 'none';
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      transition(STATE.IN_CALL);
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      if (state.isReconnecting || state.waitingForPeerReconnect) return;
      clearTimeout(state.pcFailTimer);
      state.pcFailTimer = setTimeout(() => {
        if (state.isReconnecting || state.waitingForPeerReconnect) return;
        showNotification('Соединение потеряно', 'error');
        endCall();
        screens.home();
      }, 5000);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('ICE state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      showNotification('Ошибка ICE соединения', 'error');
    }
  };

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, state.localStream);
    });
  }

  state.peerConnection = pc;
  return pc;
}

async function startWebRTC(asCreator) {
  const pc = createPeerConnection();

  if (asCreator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      state.socket.emit('offer', { sdp: pc.localDescription });
    } catch (err) {
      console.error('createOffer error:', err);
      showNotification('Ошибка создания предложения', 'error');
    }
  }
}

async function handleOffer(sdp) {
  if (!sdp || !sdp.type || !sdp.sdp) {
    console.error('Invalid SDP received');
    showNotification('Неверный формат данных соединения', 'error');
    return;
  }

  const pc = createPeerConnection();

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (state.socket && state.roomCode) {
      state.socket.emit('answer', { sdp: pc.localDescription });
    } else {
      console.error('Socket or room code not available');
      showNotification('Ошибка отправки ответа', 'error');
    }
  } catch (err) {
    console.error('handleOffer error:', err);
    showNotification('Ошибка обработки предложения соединения', 'error');
    closePeerConnection();
  }
}

async function handleAnswer(sdp) {
  if (!state.peerConnection) {
    console.error('No peer connection available');
    return;
  }

  if (!sdp || !sdp.type || !sdp.sdp) {
    console.error('Invalid SDP received');
    showNotification('Неверный формат данных соединения', 'error');
    return;
  }

  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {
    console.error('handleAnswer error:', err);
    showNotification('Ошибка установки соединения', 'error');
  }
}

async function handleIceCandidate(candidate) {
  if (!state.peerConnection) {
    console.error('No peer connection available');
    return;
  }

  if (!candidate) {
    console.warn('Received null ICE candidate');
    return;
  }

  try {
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('addIceCandidate error:', err);
  }
}

async function restartIce() {
  const pc = state.peerConnection;
  if (!pc || pc.signalingState === 'closed') {
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
    return;
  }

  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    if (state.socket && state.roomCode) {
      state.socket.emit('offer', { sdp: pc.localDescription });
    }
  } catch (err) {
    console.error('ICE restart failed, fallback to full renegotiation:', err);
    closePeerConnection();
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
  }
}

function scheduleRetry() {
  clearTimeout(retryState.timer);
  if (retryState.attempt >= RECONNECT_CONFIG.maxAttempts) return;
  if (!state.isReconnecting) return;

  const delay = Math.min(
    RECONNECT_CONFIG.baseDelay * Math.pow(2, retryState.attempt),
    RECONNECT_CONFIG.maxDelay
  );
  retryState.attempt++;

  retryState.timer = setTimeout(() => {
    if (!state.isReconnecting) return;
    updateReconnectStatus(`Попытка ${retryState.attempt}/${RECONNECT_CONFIG.maxAttempts}...`);

    if (!state.socket.connected) {
      state.socket.connect();
    }
    if (state.socket.connected && state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    } else {
      state.socket.once('connect', () => {
        if (state.roomCode && state.uuid) {
          state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
        }
      });
    }
  }, delay);
}

function updateReconnectStatus(text) {
  const el = document.getElementById('reconnect-status');
  if (el) el.textContent = text;
}

function endCall() {
  clearTimeout(state.pcFailTimer);
  clearTimeout(retryState.timer);
  retryState.attempt = 0;

  transition(STATE.HOME);

  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }

  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }
  state.savedCameraTrack = null;
  state.isScreenSharing = false;

  $('localVideo').srcObject = null;
  $('remoteVideo').srcObject = null;
  $('local-placeholder').style.display = 'none';
  $('remote-placeholder').style.display = 'none';

  $('remote-mute-indicator').style.display = 'none';
  $('remote-screen-indicator').style.display = 'none';
  $('chat-panel').style.display = 'none';
  $('btn-chat').dataset.active = 'false';
  $('chat-messages').innerHTML = '';
  state.chatUnread = 0;
  updateChatBadge();

  state.roomCode = null;
  state.isRoomCreator = false;
  state.pendingStartWebRTC = false;
  state.pendingOffer = null;

  state.isReconnecting = false;
  state.waitingForPeerReconnect = false;
  hideReconnectingOverlay();
  hidePeerWaitingOverlay();
}

function addLocalTracksToPC() {
  if (!state.peerConnection || !state.localStream) return;
  const senders = state.peerConnection.getSenders().map((s) => s.track && s.track.kind);
  state.localStream.getTracks().forEach((track) => {
    if (!senders.includes(track.kind)) {
      state.peerConnection.addTrack(track, state.localStream);
    }
  });
}

function enterRoom(code) {
  closeModal();
  state.roomCode = code;
  $('room-code').textContent = code;
  screens.room();

  getLocalMedia().then((hasMedia) => {
    if (hasMedia) {
      $('local-placeholder').style.display = 'none';
      addLocalTracksToPC();
    }
    if (state.pendingStartWebRTC && hasMedia) {
      state.pendingStartWebRTC = false;
      startWebRTC(true);
    }
    if (state.pendingOffer) {
      const sdp = state.pendingOffer;
      state.pendingOffer = null;
      handleOffer(sdp);
    }
  });
}

/* ===================================================== */
/* MODAL — Code Input                                    */
/* ===================================================== */

function showModalError(msg) {
  $('modal-error').textContent = msg;
}

function clearModalError() {
  $('modal-error').textContent = '';
}

function enableJoinButton() {
  $('btn-join-room').disabled = false;
  $('btn-join-room').textContent = 'Подключиться';
}

/* ===================================================== */
/* UI Handlers                                           */
/* ===================================================== */

function openModal() {
  if (!transition(STATE.JOIN_MODAL)) return;
  $('join-modal').style.display = 'flex';
  clearModalError();
  const input = $('code-input');
  input.value = '';
  input.focus();
}

function closeModal() {
  transition(STATE.HOME);
  $('join-modal').style.display = 'none';
  clearModalError();
}

async function handleJoinRoom() {
  const input = $('code-input');
  const code = input.value.toUpperCase();
  if (code.length !== 6) {
    showModalError('Введите 6 символов');
    return;
  }

  clearModalError();
  $('btn-join-room').disabled = true;
  $('btn-join-room').textContent = 'Подключение...';

  state.socket.emit('join-room', { code, uuid: state.uuid });
}

/* Control buttons */
async function toggleScreenShare() {
  if (state.isScreenSharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  if (!state.peerConnection) {
    showNotification('Демонстрация экрана доступна только во время звонка', 'info');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.screenStream = stream;
    const screenTrack = stream.getVideoTracks()[0];

    const videoSender = state.peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');
    if (!videoSender) {
      showNotification('Ошибка: видеотрек не найден', 'error');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    state.savedCameraTrack = videoSender.track;

    await videoSender.replaceTrack(screenTrack);

    $('localVideo').srcObject = stream;
    state.isScreenSharing = true;
    $('btn-screen').dataset.active = 'true';

    state.socket.emit('screen-share-state-change', { active: true });

    screenTrack.onended = () => {
      stopScreenShare().catch((e) => console.error('stopScreenShare onended error:', e));
    };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showNotification('Доступ к экрану запрещён', 'error');
    } else if (err.name === 'AbortError') {
      // Пользователь отменил выбор экрана — silent ignore
    } else {
      console.error('startScreenShare error:', err);
    }
  }
}

async function stopScreenShare() {
  if (!state.isScreenSharing) return;

  const videoSender = state.peerConnection
    .getSenders()
    .find((s) => s.track && s.track.kind === 'video');
  if (videoSender && state.savedCameraTrack) {
    await videoSender.replaceTrack(state.savedCameraTrack);
  }

  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }

  $('localVideo').srcObject = state.localStream;
  state.isScreenSharing = false;
  state.savedCameraTrack = null;
  $('btn-screen').dataset.active = 'false';

  state.socket.emit('screen-share-state-change', { active: false });
}

function toggleMute() {
  if (!state.localStream) return;
  const audioTracks = state.localStream.getAudioTracks();
  if (audioTracks.length === 0) return;

  const enabled = !audioTracks[0].enabled;
  audioTracks[0].enabled = enabled;
  $('btn-mute').dataset.active = enabled ? 'true' : 'false';
  if (state.socket && state.roomCode) {
    state.socket.emit('audio-state-change', { muted: !enabled });
  }
}

function toggleSpeaker() {
  const remoteVideo = $('remoteVideo');
  const muted = !remoteVideo.muted;
  remoteVideo.muted = muted;
  $('btn-speaker').dataset.active = muted ? 'false' : 'true';
}

function toggleCamera() {
  if (state.isScreenSharing) return;
  if (!state.localStream) return;
  const videoTracks = state.localStream.getVideoTracks();
  if (videoTracks.length === 0) return;

  const enabled = !videoTracks[0].enabled;
  videoTracks[0].enabled = enabled;
  $('btn-camera').dataset.active = enabled ? 'true' : 'false';
  $('local-placeholder').style.display = enabled ? 'none' : 'flex';
  $('localVideo').style.display = enabled ? 'block' : 'none';
}

function handleHangup() {
  if (state.socket && state.roomCode) {
    state.socket.emit('leave-room');
  }
  endCall();
  screens.home();
  closeModal();
  hideNotification();
}

function copyRoomCode() {
  if (state.roomCode) {
    navigator.clipboard.writeText(state.roomCode).then(() => {
      showNotification('Код скопирован', 'success');
    }).catch(() => {
      showNotification('Не удалось скопировать код', 'error');
    });
  }
}

/* ===================================================== */
/* CHAT                                                  */
/* ===================================================== */

function toggleChat() {
  const panel = $('chat-panel');
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    $('btn-chat').dataset.active = 'false';
  } else {
    panel.style.display = 'flex';
    $('btn-chat').dataset.active = 'true';
    state.chatUnread = 0;
    updateChatBadge();
    scrollChatToBottom();
  }
}

function updateChatBadge() {
  const badge = $('chat-badge');
  if (state.chatUnread > 0) {
    badge.textContent = state.chatUnread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function scrollChatToBottom() {
  const messages = $('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

function showChatToast(text) {
  const toast = $('chat-toast');
  toast.textContent = text.length > 50 ? text.slice(0, 47) + '...' : text;
  toast.style.display = 'block';
  toast.classList.remove('chat-toast-hide');
  toast.classList.add('chat-toast-show');
  if (state.chatToastTimer) clearTimeout(state.chatToastTimer);
  state.chatToastTimer = setTimeout(() => {
    toast.classList.remove('chat-toast-show');
    toast.classList.add('chat-toast-hide');
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 3000);
}

function addChatMessage(text, isOwn) {
  const messages = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message ' + (isOwn ? 'own' : 'other');
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = text + '<span class="time">' + time + '</span>';
  messages.appendChild(div);
  scrollChatToBottom();
}

function sendChatMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  state.socket.emit('send-message', { text });
  addChatMessage(text, true);
  input.value = '';
  input.focus();
}

/* ===================================================== */
/* INIT                                                  */
/* ===================================================== */

function init() {
  connectSocket();

  /* Home screen */
  $('btn-create').addEventListener('click', () => {
    if (state.appState !== STATE.HOME) return;
    state.socket.emit('create-room', { uuid: state.uuid });
  });

  $('btn-join').addEventListener('click', () => {
    if (state.appState !== STATE.HOME) return;
    openModal();
  });

  /* Modal */
  $('btn-join-room').addEventListener('click', handleJoinRoom);
  $('btn-close-modal').addEventListener('click', closeModal);
  $('join-modal').addEventListener('click', (e) => {
    if (e.target === $('join-modal')) closeModal();
  });

  const codeInput = $('code-input');
  codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  codeInput.addEventListener('focus', (e) => {
    e.target.select();
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });

  /* Room controls */
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-speaker').addEventListener('click', toggleSpeaker);
  $('btn-camera').addEventListener('click', toggleCamera);
  $('btn-screen').addEventListener('click', toggleScreenShare);
  $('btn-chat').addEventListener('click', toggleChat);
  $('btn-hangup').addEventListener('click', handleHangup);
  $('btn-leave-reconnect').addEventListener('click', () => {
    clearTimeout(retryState.timer);
    retryState.attempt = 0;
    if (state.isReconnecting) {
      state.isReconnecting = false;
      hideReconnectingOverlay();
    }
    state.waitingForPeerReconnect = false;
    hidePeerWaitingOverlay();
    handleHangup();
  });

  $('btn-retry-reconnect').addEventListener('click', () => {
    retryState.attempt = 0;
    clearTimeout(retryState.timer);
    updateReconnectStatus('Повторная попытка...');

    if (!state.socket.connected) {
      if (state._retryConnectHandler) {
        state.socket.off('connect', state._retryConnectHandler);
      }
      state._retryConnectHandler = () => {
        if (state.roomCode && state.uuid) {
          state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
        }
      };
      state.socket.once('connect', state._retryConnectHandler);
      state.socket.connect();
    } else {
      if (state.roomCode && state.uuid) {
        state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
      }
    }

    scheduleRetry();
  });

  $('btn-leave-peer-reconnect').addEventListener('click', () => {
    state.waitingForPeerReconnect = false;
    hidePeerWaitingOverlay();
    handleHangup();
  });
  $('copy-link').addEventListener('click', (e) => {
    e.preventDefault();
    copyRoomCode();
  });

  /* Chat */
  $('btn-close-chat').addEventListener('click', toggleChat);
  $('btn-send-chat').addEventListener('click', sendChatMessage);
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  loadVersion();

  /* Tab close */
  window.addEventListener('beforeunload', () => {
    if (state.socket && state.roomCode) {
      state.socket.emit('leave-room');
    }
    endCall();
  });
}

function loadVersion() {
  fetch('/version.json')
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('app-version');
      if (el) el.textContent = data.version;
    })
    .catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
