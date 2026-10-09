export interface KnowledgeAnswer { answer:string; topic:string }

const knowledge:Array<{topic:string;patterns:RegExp[];answer:string}>=[
  {topic:'crew win',patterns:[/how.*crew.*win/,/crew.*objective/,/what.*crew.*do/],answer:'Crew wins by finishing the shared task quota or ejecting every impostor. Reports and careful testimony matter as much as task speed.'},
  {topic:'impostor win',patterns:[/how.*impostor.*win/,/impostor.*objective/,/what.*impostor.*do/],answer:'Impostors win by reaching parity with the living crew or letting reactor containment expire. They can eliminate, sabotage and use vents.'},
  {topic:'roles',patterns:[/what.*role/,/crewmate.*impostor/,/how many.*impostor/],answer:'A match has four to twelve players and one or two impostors. Crewmates share a task goal; impostors know their partners.'},
  {topic:'report',patterns:[/how.*report/,/report.*body/,/what.*report/],answer:'Stand close to an unreported body and use Report. Reporting immediately starts a meeting and records the reporter and body location.'},
  {topic:'emergency',patterns:[/emergency.*meeting/,/call.*meeting/,/button.*commons/],answer:'The emergency console is in Commons. A living player can use it once when no sabotage is active.'},
  {topic:'voting',patterns:[/how.*vote/,/skip.*vote/,/tie.*vote/,/eject/],answer:'Pick one living player or skip. A tie ejects nobody. Bots vote from their own evidence and suspicion instead of copying one accusation.'},
  {topic:'vents',patterns:[/how.*vent/,/who.*vent/,/what.*vent/,/vent.*work/],answer:'Only impostors can use floor vents. A witnessed vent is strong evidence, but simply standing near a vent is not proof.'},
  {topic:'sabotage',patterns:[/what.*sabotage/,/how.*sabotage/,/lights.*reactor/],answer:'Impostors can disable lights or trigger reactor containment. Lights shorten crew vision; an unresolved reactor countdown gives impostors the win.'},
  {topic:'lights',patterns:[/fix.*light/,/lights.*off/,/where.*electrical/],answer:'The lights breaker is in Electrical on the south side of the ship. Restore its circuits before relying on distant sightings.'},
  {topic:'reactor',patterns:[/fix.*reactor/,/reactor.*where/,/containment/],answer:'Reactor is in the northwest section. Reach the glowing containment core and restore it before the countdown reaches zero.'},
  {topic:'ghosts',patterns:[/what.*ghost/,/dead.*task/,/after.*die/],answer:'Eliminated crewmates become ghosts and can continue their remaining tasks, but they cannot report, vote or speak to the living crew.'},
  {topic:'vision',patterns:[/view.*distance/,/vision/,/how far.*see/],answer:'Crew and impostor view distances are separate host settings. Lights sabotage temporarily reduces useful crew sight even further.'},
  {topic:'kill',patterns:[/kill.*cooldown/,/how.*kill/,/kill.*range/],answer:'An impostor must be alive, off cooldown, close to a visible crewmate, and unobstructed. The host controls the cooldown.'},
  {topic:'evidence',patterns:[/what.*evidence/,/proof/,/how.*know.*impostor/],answer:'Directly witnessing an elimination or vent is strong evidence. Room sightings, body proximity and inconsistent claims are clues, not automatic proof.'},
  {topic:'trust',patterns:[/should.*trust/,/who.*trust/,/trust.*bot/],answer:'Trust corroborated routes and direct observations more than confident accusations. Ask several players separately and compare their stories.'},
  {topic:'tasks',patterns:[/how many.*task/,/what.*task/,/task.*list/],answer:'The ship has data transmission, biometric scanning, core stabilization, cargo authorization, wire routing and navigation tuning.'},
  {topic:'bridge',patterns:[/where.*bridge/,/what.*bridge/],answer:'Bridge is in the northwest. Its console handles the flight-log transmission task.'},
  {topic:'medbay',patterns:[/where.*medbay/,/what.*medbay/,/scan/],answer:'Medbay is along the north corridor. Its biometric scanner requires you to remain in place until the scan completes.'},
  {topic:'cargo',patterns:[/where.*cargo/,/what.*cargo/,/card.*task/],answer:'Cargo is in the southwest. The manifest task requires moving the authorization card steadily through its reader.'},
  {topic:'navigation',patterns:[/where.*navigation/,/what.*navigation/,/frequency/],answer:'Navigation is in the southeast. Tune the beacon to the requested carrier frequency and lock it.'},
  {topic:'electrical',patterns:[/where.*electrical/,/what.*electrical/,/wire/],answer:'Electrical is on the south corridor. It contains wire routing and the emergency lights breaker.'},
  {topic:'map',patterns:[/open.*map/,/where.*map/,/map.*key/],answer:'Press M on keyboard or View/Share on a controller. Crew see unfinished tasks; impostors also see vent locations.'},
  {topic:'controls',patterns:[/what.*control/,/how.*move/,/keyboard/,/controller/],answer:'Move with WASD or the left stick and look with the mouse or right stick. Use is E or A/Cross; Report is R or Y/Triangle.'},
  {topic:'online',patterns:[/invite.*friend/,/online.*work/,/join.*code/,/lan/],answer:'Create a private room and share its invite code, join a public match, or connect on the same Wi-Fi through LAN mode. Empty seats become bots.'},
  {topic:'settings',patterns:[/change.*setting/,/game.*setting/,/custom.*rule/],answer:'The host can set player count, impostor count, crew and impostor vision, kill cooldown and whether ejected roles are confirmed.'},
  {topic:'strategy crew',patterns:[/crew.*strategy/,/how.*find/,/best.*crew/],answer:'Track who entered and left rooms, ask for exact routes, compare separate accounts, and avoid treating one weak accusation as certainty.'},
  {topic:'strategy impostor',patterns:[/impostor.*strategy/,/how.*lie/,/best.*impostor/],answer:'Maintain a believable route, avoid kills near witnesses, use sabotage to divide attention, and do not over-defend your partner.'},
];

export function answerKnowledge(question:string):KnowledgeAnswer|null{
  const q=question.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  for(const entry of knowledge)if(entry.patterns.some(pattern=>pattern.test(q)))return{answer:entry.answer,topic:entry.topic};
  return null;
}
