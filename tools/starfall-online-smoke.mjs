import { Client } from '../client/node_modules/@colyseus/sdk/build/index.mjs';

const url = process.argv[2] ?? 'ws://127.0.0.1:2568';
const impostors = Number(process.argv[3] ?? 2);
const waitFor = (room, type, accept = () => true, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeout);
  const off = room.onMessage(type, value => {
    if (!accept(value)) return;
    clearTimeout(timer);
    off();
    resolve(value);
  });
});

const options = name => ({ version: 1, name, color: name === 'Host' ? 2 : 5 });
const host = await new Client(url).create('starfall', { ...options('Host'), visibility: 'private' });
const guest = await new Client(url).joinById(host.roomId, options('Guest'));

try {
  const hostLobbyP = waitFor(host, 'sf:lobby', v => v.players.length === 2 && v.config.players === 7 && v.config.impostors === impostors);
  const guestLobbyP = waitFor(guest, 'sf:lobby', v => v.players.length === 2 && v.config.players === 7 && v.config.impostors === impostors);
  host.send('sf:cfg', { players: 7, impostors, crewVision: 8, impostorVision: 15, killCooldown: 18, confirmEjects: false });
  const [hostLobby, guestLobby] = await Promise.all([hostLobbyP, guestLobbyP]);
  if (hostLobby.code !== host.roomId || guestLobby.code !== host.roomId) throw new Error('Invite code mismatch');
  if (hostLobby.config.bots !== 5) throw new Error(`Expected five fill bots, got ${hostLobby.config.bots}`);

  const hostBeginP = waitFor(host, 'sf:begin');
  const guestBeginP = waitFor(guest, 'sf:begin');
  const hostSnapP = waitFor(host, 'sf:snap');
  const guestSnapP = waitFor(guest, 'sf:snap');
  host.send('sf:start');
  const [hostBegin, guestBegin, hostSnap, guestSnap] = await Promise.all([hostBeginP, guestBeginP, hostSnapP, guestSnapP]);

  if (hostBegin.me !== 0 || guestBegin.me !== 1) throw new Error('Player ownership indices are incorrect');
  if (hostBegin.people.length !== 7 || guestBegin.people.length !== 7) throw new Error('Roster was not filled to seven');
  for (const begin of [hostBegin, guestBegin]) {
    if (begin.role === 'crew' && begin.partners.length) throw new Error('Crew client was told impostor identities');
    if (begin.role === 'impostor' && begin.partners.length !== impostors - 1) throw new Error('Impostor did not receive the correct partner list');
  }
  const hostVisibleImpostors = hostSnap.people.filter(p => p[4] & 2).length;
  const guestVisibleImpostors = guestSnap.people.filter(p => p[4] & 2).length;
  if (hostVisibleImpostors !== (hostBegin.role === 'impostor' ? impostors : 0)) throw new Error('Host role visibility leak');
  if (guestVisibleImpostors !== (guestBegin.role === 'impostor' ? impostors : 0)) throw new Error('Guest role visibility leak');

  const before = guestSnap.people[1];
  const movedP = waitFor(guest, 'sf:snap', v => Math.hypot(v.people[1][1] - before[1], v.people[1][2] - before[2]) > 0.1);
  guest.send('sf:in', { x: 1, z: 0, yaw: 0 });
  const moved = await movedP;
  guest.send('sf:in', { x: 0, z: 0, yaw: 0 });
  const meetingP = waitFor(host, 'sf:event', e => e.k === 'meeting');
  host.send('sf:act', { k: 'emergency' });
  await meetingP;
  const humanChatP = waitFor(host, 'sf:event', e => e.k === 'chat' && e.id === 1 && e.text === 'where were you and what did you see?');
  const botChatP = waitFor(host, 'sf:event', e => e.k === 'chat' && e.id >= 2);
  guest.send('sf:act', { k: 'chat', text: 'where were you and what did you see?' });
  const [humanChat, botChat] = await Promise.all([humanChatP, botChatP]);
  console.log(JSON.stringify({
    ok: true,
    room: host.roomId,
    roster: hostBegin.people.length,
    bots: hostLobby.config.bots,
    roles: [hostBegin.role, guestBegin.role],
    partnersRevealedOnlyToImpostors: true,
    guestMoved: [before[1], before[2], moved.people[1][1], moved.people[1][2]],
    meetingChat: { human: humanChat.text, bot: botChat.text },
  }, null, 2));
} finally {
  await Promise.allSettled([host.leave(true), guest.leave(true)]);
}
