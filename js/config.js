/* Team Quiz settings. Edit here if you ever need to change how players connect. */
window.TQ_CONFIG = {
  // Prefix for room IDs on the free PeerJS broker. Keep it unusual so other apps never collide with us.
  peerPrefix: 'vinny-teamquiz-v1-',

  // Options passed to PeerJS. If some players cannot join (company VPN blocking direct
  // connections), add a TURN server to iceServers, for example:
  //   { urls: 'turn:YOUR-TURN-HOST:443?transport=tcp', username: 'user', credential: 'pass' }
  peerOptions: {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  },

  previewSeconds: 5,      // question shown on its own before answers open (like Kahoot)
  maxPlayers: 40,
  maxNameLength: 16
};
// Automated tests point the app at a local copy of the PeerJS server.
if (window.TQ_TEST_PEER) Object.assign(window.TQ_CONFIG.peerOptions, window.TQ_TEST_PEER);
