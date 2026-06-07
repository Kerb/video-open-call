const STATE = {
  HOME: 'home',
  JOIN_MODAL: 'join-modal',
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  IN_CALL: 'in-call',
};

const STATE_TRANSITIONS = {
  [STATE.HOME]: [STATE.JOIN_MODAL, STATE.WAITING],
  [STATE.JOIN_MODAL]: [STATE.HOME, STATE.WAITING],
  [STATE.WAITING]: [STATE.CONNECTING, STATE.HOME],
  [STATE.CONNECTING]: [STATE.IN_CALL, STATE.HOME],
  [STATE.IN_CALL]: [STATE.HOME],
};

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

/* ===================================================== */
/* SOCKET.IO                                             */
/* ===================================================== */

function connectSocket() {
  state.socket = io({
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });

  state.socket.on('connect', () => {
    console.log('Socket connected');
  });

  state.socket.on('disconnect', () => {
    console.log('Socket disconnected');
    if (state.appState !== STATE.HOME) {
      showNotification('Потеря соединения с сервером', 'error');
    }
  });

  state.socket.on('reconnect_attempt', () => {
    console.log('Reconnecting...');
  });

  state.socket.on('reconnect', () => {
    console.log('Reconnected');
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
    if (state.localStream) {
      startWebRTC(true);
    } else {
      state.pendingStartWebRTC = true;
    }
  });

  state.socket.on('offer', ({ sdp }) => {
    transition(STATE.CONNECTING);
    if (state.localStream) {
      handleOffer(sdp);
    } else {
      state.pendingOffer = sdp;
    }
  });

  state.socket.on('answer', ({ sdp }) => {
    handleAnswer(sdp);
  });

  state.socket.on('ice-candidate', ({ candidate }) => {
    handleIceCandidate(candidate);
  });

  state.socket.on('peer-disconnected', () => {
    showNotification('Собеседник отключился', 'info');
    endCall();
    screens.home();
  });

  state.socket.on('room-not-found', () => {
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
    $('local-placeholder').style.display = 'none';
    video.style.display = 'block';
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
      showNotification('Соединение потеряно', 'error');
      endCall();
      screens.home();
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
  const pc = createPeerConnection();

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.socket.emit('answer', { sdp: pc.localDescription });
  } catch (err) {
    console.error('handleOffer error:', err);
    showNotification('Ошибка обработки предложения', 'error');
  }
}

async function handleAnswer(sdp) {
  if (!state.peerConnection) return;
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {
    console.error('handleAnswer error:', err);
  }
}

async function handleIceCandidate(candidate) {
  if (!state.peerConnection) return;
  try {
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('addIceCandidate error:', err);
  }
}

function endCall() {
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

const CODE_INPUTS = document.querySelectorAll('.code-input');

function setupCodeInputs() {
  CODE_INPUTS.forEach((input) => {
    input.addEventListener('input', (e) => {
      let char = e.target.value.toUpperCase();
      char = char.replace(/[^A-Z0-9]/g, '');
      if (char.length > 1) char = char[char.length - 1];
      e.target.value = char;

      if (char) {
        const next = e.target.nextElementSibling;
        if (next && next.classList.contains('code-input')) {
          next.focus();
        } else {
          $('btn-join-room').focus();
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value) {
        const prev = e.target.previousElementSibling;
        if (prev && prev.classList.contains('code-input')) {
          prev.focus();
        }
      }

      if (e.key === 'Enter') {
        handleJoinRoom();
      }
    });

    input.addEventListener('focus', (e) => {
      e.target.select();
    });
  });
}

function getCodeFromInputs() {
  let code = '';
  CODE_INPUTS.forEach((input) => {
    code += input.value.toUpperCase();
  });
  return code;
}

function clearCodeInputs() {
  CODE_INPUTS.forEach((input) => {
    input.value = '';
  });
  CODE_INPUTS[0].focus();
}

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
  clearCodeInputs();
}

function closeModal() {
  transition(STATE.HOME);
  $('join-modal').style.display = 'none';
  clearModalError();
}

async function handleJoinRoom() {
  const code = getCodeFromInputs();
  if (code.length !== 6) {
    showModalError('Введите 6 символов');
    return;
  }

  clearModalError();
  $('btn-join-room').disabled = true;
  $('btn-join-room').textContent = 'Подключение...';

  state.socket.emit('join-room', { code });
}

/* Control buttons */
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
  setupCodeInputs();
  connectSocket();

  /* Home screen */
  $('btn-create').addEventListener('click', () => {
    if (state.appState !== STATE.HOME) return;
    state.socket.emit('create-room');
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

  /* Room controls */
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-speaker').addEventListener('click', toggleSpeaker);
  $('btn-camera').addEventListener('click', toggleCamera);
  $('btn-chat').addEventListener('click', toggleChat);
  $('btn-hangup').addEventListener('click', handleHangup);
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

  /* Tab close */
  window.addEventListener('beforeunload', () => {
    if (state.socket && state.roomCode) {
      state.socket.emit('leave-room');
    }
    endCall();
  });
}

document.addEventListener('DOMContentLoaded', init);
