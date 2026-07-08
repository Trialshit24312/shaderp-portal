/**
 * ShadeRP AC — WebRTC live watch client (signaling via portal HTTP).
 * Falls back to HTTP frame polling when WebRTC is unavailable.
 */

const POLL_MS = 700;
const WEBRTC_POLL_MS = 250;
const ICE_POLL_MS = 400;

export function webrtcSupported() {
  return typeof RTCPeerConnection !== 'undefined';
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function createWebRtcWatch({ sessionId, playerId, onFrame, onStatus }) {
  if (!webrtcSupported()) return null;

  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const iceRes = await fetch('/api/ac/admin/ice-config');
    if (iceRes.ok) {
      const iceData = await iceRes.json();
      if (iceData.iceServers?.length) iceServers = iceData.iceServers;
    }
  } catch (_) {}

  const pc = new RTCPeerConnection({ iceServers });

  const dc = pc.createDataChannel('frames', { ordered: false, maxRetransmits: 0 });
  dc.binaryType = 'arraybuffer';

  let connected = false;
  let playerIceIdx = 0;
  let icePollActive = true;

  dc.onmessage = (ev) => {
    if (!onFrame || typeof ev.data !== 'string') return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.image) onFrame(msg.image);
    } catch (_) {}
  };

  dc.onopen = () => {
    connected = true;
    onStatus?.('connected');
  };

  pc.onconnectionstatechange = () => {
    onStatus?.(pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      icePollActive = false;
    }
  };

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    fetch('/api/ac/admin/webrtc/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, candidate: ev.candidate.toJSON() }),
    }).catch(() => {});
  };

  const pollPlayerIce = async () => {
    while (icePollActive) {
      try {
        const res = await fetch(
          `/api/ac/admin/webrtc/player-ice/${encodeURIComponent(sessionId)}?since=${playerIceIdx}`,
        );
        if (res.ok) {
          const data = await res.json();
          for (const c of data.candidates || []) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          if (typeof data.total === 'number') playerIceIdx = data.total;
        }
      } catch (_) {}
      await wait(ICE_POLL_MS);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await fetch('/api/ac/admin/webrtc/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId, sdp: offer.sdp }),
  });

  pollPlayerIce();

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/ac/admin/webrtc/answer/${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const { answer, playerIce } = await res.json();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      for (const c of playerIce || []) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      playerIceIdx = (playerIce || []).length;

      const openDeadline = Date.now() + 20000;
      while (Date.now() < openDeadline) {
        if (connected || dc.readyState === 'open') {
          return {
            pc,
            dc,
            close: () => {
              icePollActive = false;
              pc.close();
            },
          };
        }
        await wait(WEBRTC_POLL_MS);
      }
      if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') {
        return {
          pc,
          dc,
          close: () => {
            icePollActive = false;
            pc.close();
          },
        };
      }
    }
    await wait(WEBRTC_POLL_MS);
  }

  icePollActive = false;
  pc.close();
  return null;
}

export function startHttpFramePoll({ sessionId, onFrame, intervalMs = POLL_MS }) {
  let timer = null;
  let active = true;

  async function tick() {
    if (!active) return;
    try {
      const res = await fetch(`/api/ac/admin/frame/${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const frame = await res.json();
        if (frame?.image) onFrame?.(frame.image);
      }
    } catch (_) {}
    if (active) timer = setTimeout(tick, intervalMs);
  }

  tick();
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}

/**
 * HTTP frame polling always runs; WebRTC is an optional low-latency overlay.
 */
export async function startLiveWatch({ sessionId, playerId, onFrame, onMode }) {
  onMode?.('http');
  const stopHttp = startHttpFramePoll({ sessionId, onFrame });

  let stopRtc = null;
  try {
    const rtc = await createWebRtcWatch({
      sessionId,
      playerId,
      onFrame,
      onStatus: (s) => {
        if (s === 'connected') onMode?.('webrtc');
        if (s === 'failed' || s === 'disconnected') onMode?.('http');
      },
    });
    if (rtc) {
      onMode?.('webrtc');
      stopRtc = () => rtc.close();
    }
  } catch (_) {}

  return () => {
    stopHttp();
    if (stopRtc) stopRtc();
  };
}
