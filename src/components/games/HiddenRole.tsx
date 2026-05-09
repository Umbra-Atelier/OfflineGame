import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GameMessage } from '../../types';
import { Moon, Sun, Skull, Shield, Search, User, Key, Play } from 'lucide-react';

interface HiddenRoleProps {
  channel: RTCDataChannel;
  isHost: boolean;
  onBackToLobby: () => void;
}

type Role = 'MURDERER' | 'DETECTIVE' | 'SHERIFF' | 'JESTER' | 'VILLAGER';
type Phase = 'SETUP' | 'NIGHT' | 'DAY_SUMMARY' | 'VOTING' | 'LYNCH_RESULT' | 'GAME_OVER';

interface Player {
  id: string;
  name: string;
  isBot: boolean;
  role: Role;
  isAlive: boolean;
}

// Minimal sync state sent to the guest
interface SyncState {
  phase: Phase;
  dayCount: number;
  players: any[]; // guest only sees roles for themselves or dead people
  log: string[];
  myRole: Role | null;
  myNightResult: string | null;
  winnerInfo: { winner: string, message: string } | null;
  lynchResultInfo: { message: string } | null;
}

const ROLE_NAMES: Record<Role, string> = {
  MURDERER: 'Murderer',
  DETECTIVE: 'Detective',
  SHERIFF: 'Sheriff',
  JESTER: 'Jester',
  VILLAGER: 'Villager',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  MURDERER: 'Choose someone to eliminate each night. Win by outnumbering the town.',
  DETECTIVE: 'Investigate someone each night to discover if they are the Murderer.',
  SHERIFF: 'Protect someone each night from being killed.',
  JESTER: 'Convince the town to vote you out to win the game alone!',
  VILLAGER: 'You have no special abilities. Use your wits to vote out the Murderer.',
};

export function HiddenRole({ channel, isHost, onBackToLobby }: HiddenRoleProps) {
  // --------- HOST ONLY STATE ---------
  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>('SETUP');
  const [dayCount, setDayCount] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const [botCount, setBotCount] = useState(4);
  const [winnerInfo, setWinnerInfo] = useState<{winner: string, message: string} | null>(null);
  const [lynchResultInfo, setLynchResultInfo] = useState<{message: string} | null>(null);
  
  // Pending actions
  const [nightActions, setNightActions] = useState<Record<string, string>>({}); // actor -> target
  const [votes, setVotes] = useState<Record<string, string>>({}); // voter -> target

  // --------- GUEST AND HOST SHARED VIEW STATE ---------
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  // Local user selection
  const [localSelection, setLocalSelection] = useState<string>('');
  const [hasSubmittedLocalAction, setHasSubmittedLocalAction] = useState(false);

  const myId = isHost ? 'player-host' : 'player-joiner';

  // Helper to send game messages over WebRTC
  const sendMessage = useCallback((payload: any) => {
    if (channel.readyState === 'open') {
      const msg: GameMessage = {
        type: 'GAME_MESSAGE',
        game: 'HIDDEN_ROLE',
        payload
      };
      channel.send(JSON.stringify(msg));
    }
  }, [channel]);

  // Host: Compute state and broadcast to guest
  const broadcastSyncState = useCallback((
    currentPlayers: Player[],
    currentPhase: Phase,
    currentDay: number,
    currentLog: string[],
    currentWinner: any,
    currentLynch: any,
    guestNightResult: string | null = null
  ) => {
    if (!isHost) return;

    // What guest sees:
    const guestState: SyncState = {
      phase: currentPhase,
      dayCount: currentDay,
      log: currentLog,
      winnerInfo: currentWinner,
      lynchResultInfo: currentLynch,
      myRole: currentPlayers.find(p => p.id === 'player-joiner')?.role || null,
      myNightResult: guestNightResult,
      players: currentPlayers.map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
        isBot: p.isBot,
        // Only reveal roles of dead people (or their own)
        role: (!p.isAlive || p.id === 'player-joiner') ? p.role : null
      }))
    };

    sendMessage({ type: 'SYNC', state: guestState });

    // Host local update for what Host sees
    setSyncState({
      phase: currentPhase,
      dayCount: currentDay,
      log: currentLog,
      winnerInfo: currentWinner,
      lynchResultInfo: currentLynch,
      myRole: currentPlayers.find(p => p.id === 'player-host')?.role || null,
      myNightResult: null, // Host gets results directly in log or local state
      players: currentPlayers.map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
        isBot: p.isBot,
        role: (!p.isAlive || p.id === 'player-host') ? p.role : null
      }))
    });

  }, [isHost, sendMessage]);

  // Handle incoming messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'GAME_MESSAGE' && message.game === 'HIDDEN_ROLE') {
        const data = message.payload;
        
        if (data.type === 'SYNC' && !isHost) {
          setSyncState(data.state);
          // reset local UI state on phase change if needed
          if (syncState?.phase !== data.state.phase) {
            setLocalSelection('');
            setHasSubmittedLocalAction(false);
          }
        } 
        else if (data.type === 'SUBMIT_NIGHT_ACTION' && isHost) {
          setNightActions(prev => ({ ...prev, [data.actorId]: data.targetId }));
        }
        else if (data.type === 'SUBMIT_VOTE' && isHost) {
          setVotes(prev => ({ ...prev, [data.voterId]: data.targetId }));
        }
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => channel.removeEventListener('message', handleMessage);
  }, [channel, isHost, syncState?.phase]);

  // --- HOST LOGIC: Starting the game ---
  const startGame = () => {
    if (!isHost) return;

    const totalPlayers = 2 + botCount;
    const newPlayers: Player[] = [
      { id: 'player-host', name: 'Host (You)', isBot: false, role: 'VILLAGER', isAlive: true },
      { id: 'player-joiner', name: 'Joiner', isBot: false, role: 'VILLAGER', isAlive: true },
    ];
    for (let i = 0; i < botCount; i++) {
      newPlayers.push({ id: `bot-${i+1}`, name: `Bot ${i+1}`, isBot: true, role: 'VILLAGER', isAlive: true });
    }

    // Role distribution pool
    const roles: Role[] = ['MURDERER'];
    if (totalPlayers >= 4) roles.push('DETECTIVE');
    if (totalPlayers >= 5) roles.push('SHERIFF');
    if (totalPlayers >= 6) roles.push('JESTER');
    while (roles.length < totalPlayers) roles.push('VILLAGER');

    // Shuffle roles
    roles.sort(() => Math.random() - 0.5);
    newPlayers.forEach((p, idx) => {
      p.role = roles[idx];
    });

    setPlayers(newPlayers);
    setPhase('NIGHT');
    setDayCount(1);
    setLog(["The game has started. Everyone goes to sleep..."]);
    setNightActions({});
    setVotes({});
    setWinnerInfo(null);
    setLynchResultInfo(null);
    setLocalSelection('');
    setHasSubmittedLocalAction(false);
    
    // Initial sync
    broadcastSyncState(newPlayers, 'NIGHT', 1, ["The game has started. Everyone goes to sleep..."], null, null);
  };

  // --- HOST LOGIC: Check Night Actions ---
  useEffect(() => {
    if (!isHost || phase !== 'NIGHT') return;

    const aliveHumans = players.filter(p => !p.isBot && p.isAlive);
    const humansWithAction = aliveHumans.filter(p => p.role === 'MURDERER' || p.role === 'DETECTIVE' || p.role === 'SHERIFF');
    
    // Check if humans have submitted (Villager/Jester just need to submit 'SKIP')
    const allHumansSubmitted = aliveHumans.every(p => nightActions[p.id] !== undefined);

    if (allHumansSubmitted) {
      resolveNight();
    }
  }, [nightActions, phase, isHost, players]);

  // --- HOST LOGIC: Resolve Night ---
  const resolveNight = () => {
    const finalActions: Record<string, string> = { ...nightActions };
    const alivePlayers = players.filter(p => p.isAlive);

    // Bot night actions
    alivePlayers.forEach(p => {
      if (p.isBot) {
        if (p.role === 'MURDERER') {
          const targets = alivePlayers.filter(x => x.role !== 'MURDERER');
          if (targets.length > 0) finalActions[p.id] = targets[Math.floor(Math.random() * targets.length)].id;
        } else if (p.role === 'DETECTIVE') {
          const targets = alivePlayers.filter(x => x.id !== p.id);
          if (targets.length > 0) finalActions[p.id] = targets[Math.floor(Math.random() * targets.length)].id;
        } else if (p.role === 'SHERIFF') {
          const targets = alivePlayers.filter(x => x.id !== p.id); // Maybe protect random
          if (targets.length > 0) finalActions[p.id] = targets[Math.floor(Math.random() * targets.length)].id;
        }
      }
    });

    let killTarget: string | null = null;
    let protectTarget: string | null = null;
    let guestInvestigationResult: string | null = null;
    let hostInvestigationResult: string | null = null;

    // Aggregate actions
    Object.entries(finalActions).forEach(([actorId, targetId]) => {
      const actor = players.find(p => p.id === actorId);
      if (!actor) return;

      if (actor.role === 'MURDERER' && targetId !== 'SKIP') killTarget = targetId as string;
      if (actor.role === 'SHERIFF' && targetId !== 'SKIP') protectTarget = targetId as string;
      if (actor.role === 'DETECTIVE' && targetId !== 'SKIP') {
        const target = players.find(p => p.id === targetId);
        const result = target?.role === 'MURDERER' ? `${target.name} is the MURDERER!` : `${target?.name} is NOT the murderer.`;
        if (actorId === 'player-joiner') guestInvestigationResult = result;
        if (actorId === 'player-host') hostInvestigationResult = result;
      }
    });

    const newLog = [];
    const newPlayers = [...players];
    let murdererBlocked = false;

    if (killTarget && killTarget === protectTarget) {
      newLog.push("Someone was attacked, but they were protected by the Sheriff!");
      murdererBlocked = true;
    } else if (killTarget) {
      const victim = newPlayers.find(p => p.id === killTarget);
      if (victim) {
        victim.isAlive = false;
        newLog.push(`${victim.name} was found dead. They were the ${ROLE_NAMES[victim.role]}.`);
      }
    } else {
      newLog.push("It was a quiet night... Nobody died.");
    }

    if (hostInvestigationResult) {
      newLog.push(`[Your Investigation]: ${hostInvestigationResult}`);
    }

    setPlayers(newPlayers);
    setLog(newLog);
    
    if (checkWinConditions(newPlayers)) return;

    setPhase('DAY_SUMMARY');
    setVotes({}); // reset votes for day
    setLocalSelection('');
    setHasSubmittedLocalAction(false);
    broadcastSyncState(newPlayers, 'DAY_SUMMARY', dayCount, newLog, null, null, guestInvestigationResult);
  };

  // --- HOST LOGIC: Check Votes ---
  useEffect(() => {
    if (!isHost || phase !== 'VOTING') return;

    const aliveHumans = players.filter(p => !p.isBot && p.isAlive);
    const allHumansVoted = aliveHumans.every(p => votes[p.id] !== undefined);

    if (allHumansVoted) {
      resolveVoting();
    }
  }, [votes, phase, isHost, players]);

  // --- HOST LOGIC: Resolve Votes ---
  const resolveVoting = () => {
    const finalVotes: Record<string, string> = { ...votes };
    const alivePlayers = players.filter(p => p.isAlive);

    // Bot voting
    alivePlayers.forEach(p => {
      if (p.isBot) {
        const validTargets = alivePlayers.filter(x => x.id !== p.id);
        const validChoices = [...validTargets.map(x=>x.id), 'SKIP', 'SKIP']; // bots have 2 chances to abstain to simulate indecision
        finalVotes[p.id] = validChoices[Math.floor(Math.random() * validChoices.length)];
      }
    });

    // Tally
    const tally: Record<string, number> = {};
    Object.values(finalVotes).forEach(target => {
      if (target !== 'SKIP') {
        tally[target as string] = (tally[target as string] || 0) + 1;
      }
    });

    let highestVoteCount = 0;
    let lynchedId: string | null = null;
    let tied = false;

    Object.entries(tally).forEach(([target, count]) => {
      if (count > highestVoteCount) {
        highestVoteCount = count;
        lynchedId = target;
        tied = false;
      } else if (count === highestVoteCount) {
        tied = true;
      }
    });

    const newPlayers = [...players];
    let lynchMsg = "The town could not agree and decided to skip the vote.";

    if (lynchedId && !tied) {
      const lynched = newPlayers.find(p => p.id === lynchedId);
      if (lynched) {
        lynched.isAlive = false;
        lynchMsg = `The town voted to lynch ${lynched.name}. They were the ${ROLE_NAMES[lynched.role]}.`;
        
        if (lynched.role === 'JESTER') {
          setWinnerInfo({ winner: 'JESTER', message: `${lynched.name} (Jester) successfully got themselves lynched and wins!` });
          setPhase('GAME_OVER');
          broadcastSyncState(newPlayers, 'GAME_OVER', dayCount, [], { winner: 'JESTER', message: `${lynched.name} (Jester) successfully got themselves lynched and wins!` }, { message: lynchMsg });
          return; // Early termination
        }
      }
    } else if (tied && highestVoteCount > 0) {
      lynchMsg = "There was a tie in votes! Nobody is lynched today.";
    }

    if (checkWinConditions(newPlayers)) return;

    setPhase('LYNCH_RESULT');
    setLynchResultInfo({ message: lynchMsg });
    setLocalSelection('');
    setHasSubmittedLocalAction(false);
    broadcastSyncState(newPlayers, 'LYNCH_RESULT', dayCount, log, null, { message: lynchMsg });
  };

  const proceedToNight = () => {
    if (!isHost) return;
    setDayCount(d => d + 1);
    setPhase('NIGHT');
    setNightActions({});
    setVotes({});
    setLocalSelection('');
    setHasSubmittedLocalAction(false);
    broadcastSyncState(players, 'NIGHT', dayCount + 1, ["A new night begins..."], null, null);
  };

  const proceedToVoting = () => {
    if (!isHost) return;
    setPhase('VOTING');
    setLocalSelection('');
    setHasSubmittedLocalAction(false);
    broadcastSyncState(players, 'VOTING', dayCount, log, null, null);
  };

  const checkWinConditions = (currentPlayers: Player[]): boolean => {
    const alive = currentPlayers.filter(p => p.isAlive);
    const murderers = alive.filter(p => p.role === 'MURDERER').length;
    const innocent = alive.length - murderers;

    if (murderers === 0) {
      setWinnerInfo({ winner: 'TOWN', message: "The Murderer has been eliminated. The Town wins!" });
      setPhase('GAME_OVER');
      broadcastSyncState(currentPlayers, 'GAME_OVER', dayCount, log, { winner: 'TOWN', message: "The Murderer has been eliminated. The Town wins!" }, lynchResultInfo);
      return true;
    }
    
    if (murderers >= innocent) {
      setWinnerInfo({ winner: 'MURDERER', message: "The Murderers have gained the majority. The Murderer wins!" });
      setPhase('GAME_OVER');
      broadcastSyncState(currentPlayers, 'GAME_OVER', dayCount, log, { winner: 'MURDERER', message: "The Murderers have gained the majority. The Murderer wins!" }, lynchResultInfo);
      return true;
    }

    return false;
  };

  // --- LOCAL USER ACTIONS ---
  const submitNightAction = () => {
    if (isHost) {
      setNightActions(prev => ({ ...prev, [myId]: localSelection || 'SKIP' }));
    } else {
      sendMessage({ type: 'SUBMIT_NIGHT_ACTION', actorId: myId, targetId: localSelection || 'SKIP' });
    }
    setHasSubmittedLocalAction(true);
  };

  const submitVoteAction = () => {
    if (isHost) {
      setVotes(prev => ({ ...prev, [myId]: localSelection || 'SKIP' }));
    } else {
      sendMessage({ type: 'SUBMIT_VOTE', voterId: myId, targetId: localSelection || 'SKIP' });
    }
    setHasSubmittedLocalAction(true);
  };

  const restartGame = () => {
    if (isHost) {
      setPhase('SETUP');
      setSyncState({ ...syncState, phase: 'SETUP' } as SyncState);
      broadcastSyncState([], 'SETUP', 1, [], null, null);
    }
  };

  // --- RENDER HELPERS ---
  const uiState = syncState || {
    phase: 'SETUP',
    dayCount: 1,
    players: [],
    log: [],
    myRole: null as Role | null,
    myNightResult: null,
    winnerInfo: null,
    lynchResultInfo: null
  };

  const aliveTargets = uiState.players.filter(p => p.isAlive && p.id !== myId);
  const amIAlive = uiState.players.find(p => p.id === myId)?.isAlive ?? false;

  const requiresTarget = ['MURDERER', 'DETECTIVE', 'SHERIFF'].includes(uiState.myRole || '');

  return (
    <div className="flex flex-col items-center justify-start py-6 w-full max-w-md mx-auto min-h-[70vh] gap-4">
      <div className="flex w-full justify-between items-center px-2 mb-2">
        <button 
          onClick={onBackToLobby}
          className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          &larr; Lobby
        </button>
        {uiState.phase !== 'SETUP' && (
           <span className="font-bold text-neutral-800 bg-neutral-200/60 px-4 py-1.5 rounded-full text-xs font-mono uppercase tracking-widest border border-neutral-300">
             Day {uiState.dayCount}
           </span>
        )}
      </div>

      {uiState.phase !== 'SETUP' && uiState.myRole && (
        <div className="w-full bg-white border border-neutral-200/60 p-5 sm:p-6 rounded-3xl shadow-sm mb-4 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-2xl border ${
              uiState.myRole === 'MURDERER' ? 'bg-rose-50 border-rose-200 text-rose-600' :
              uiState.myRole === 'DETECTIVE' ? 'bg-indigo-50 border-indigo-200 text-indigo-600' :
              uiState.myRole === 'SHERIFF' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' :
              uiState.myRole === 'JESTER' ? 'bg-violet-50 border-violet-200 text-violet-600' :
              'bg-neutral-50 border-neutral-200 text-neutral-600'
            }`}>
              {uiState.myRole === 'MURDERER' && <Skull className="w-7 h-7" />}
              {uiState.myRole === 'DETECTIVE' && <Search className="w-7 h-7" />}
              {uiState.myRole === 'SHERIFF' && <Shield className="w-7 h-7" />}
              {uiState.myRole === 'JESTER' && <User className="w-7 h-7 animate-bounce delay-150" />}
              {uiState.myRole === 'VILLAGER' && <User className="w-7 h-7" />}
            </div>
            <div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-[0.2em] font-bold mb-1">Your Secret Role</p>
              <h3 className="text-2xl font-display font-bold text-neutral-900 leading-none tracking-tight">
                {ROLE_NAMES[uiState.myRole]}
              </h3>
            </div>
          </div>
          <p className="text-sm text-neutral-600 mt-4 leading-relaxed font-medium">
            {ROLE_DESCRIPTIONS[uiState.myRole]}
          </p>
          {!amIAlive && (
            <div className="mt-4 bg-rose-50 text-rose-800 text-sm p-3 rounded-xl border border-rose-200/50 font-bold flex items-center gap-2">
              <Skull className="w-4 h-4" /> You are dead. You can observe the rest of the game.
            </div>
          )}
        </div>
      )}

      {/* SETUP PHASE */}
      {uiState.phase === 'SETUP' && isHost && (
        <div className="w-full bg-white p-8 rounded-3xl shadow-sm border border-neutral-200/60 flex flex-col items-center">
          <h2 className="text-3xl font-bold text-neutral-900 mb-8 font-display tracking-tight">Setup Town</h2>
          
          <div className="w-full mb-8 bg-neutral-50 p-6 rounded-2xl border border-neutral-100">
            <label className="block text-sm font-bold text-neutral-700 mb-4 flex items-center justify-between">
              Number of AI Bots 
              <span className="text-indigo-600 text-lg bg-indigo-50 px-3 py-1 rounded-lg">{botCount}</span>
            </label>
            <input 
              type="range" min="2" max="6" step="1" 
              value={botCount} 
              onChange={e => setBotCount(parseInt(e.target.value))}
              className="w-full h-3 bg-neutral-200 rounded-full appearance-none cursor-pointer accent-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all" 
            />
            <div className="flex justify-between text-xs font-medium text-neutral-400 mt-3 px-1 uppercase tracking-wider">
              <span>2 Bots</span>
              <span>6 Bots</span>
            </div>
          </div>

          <button 
            onClick={startGame}
            className="w-full py-4 bg-indigo-600 text-white font-bold text-lg rounded-2xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition flex justify-center items-center gap-2 active:scale-[0.98]"
          >
            Start Investigation <Play className="w-5 h-5"/>
          </button>
        </div>
      )}

      {uiState.phase === 'SETUP' && !isHost && (
        <div className="w-full flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-500 bg-white rounded-3xl border border-neutral-100 shadow-sm">
           <Search className="w-16 h-16 mb-6 text-neutral-300 animate-bounce delay-150" />
           <p className="text-lg font-medium leading-relaxed">Waiting for Host to configure and start the game...</p>
        </div>
      )}

      {/* NIGHT PHASE */}
      {uiState.phase === 'NIGHT' && (
        <div className="w-full flex flex-col space-y-4 animate-in fade-in">
          <div className="bg-indigo-950 text-white p-6 sm:p-8 rounded-3xl shadow-lg border border-indigo-900/50 flex items-center justify-between overflow-hidden relative">
            <div className="relative z-10">
              <h2 className="text-3xl font-bold font-display tracking-tight mb-2 text-indigo-50">The Night Falls</h2>
              <p className="text-sm font-medium text-indigo-300/80">The town sleeps... but some are awake.</p>
            </div>
            <Moon className="w-16 h-16 text-indigo-400/20 absolute -right-2 -bottom-2 transform -rotate-12 z-0" />
            <Moon className="w-12 h-12 text-indigo-300 relative z-10 drop-shadow-md" />
          </div>

          {!amIAlive ? (
            <div className="p-6 text-center text-neutral-500 bg-neutral-100 rounded-3xl border border-neutral-200 decoration-neutral-400 font-medium font-mono text-sm uppercase tracking-widest shadow-inner">
              Dead players cannot take actions
            </div>
          ) : !hasSubmittedLocalAction ? (
             <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-neutral-200/60">
               <h3 className="font-bold text-neutral-800 mb-5 uppercase text-xs tracking-widest flex items-center gap-2"><Key className="w-4 h-4 text-indigo-500"/> Your Action</h3>
               {requiresTarget ? (
                 <div className="space-y-4">
                   <select 
                     className="w-full p-4 border-2 border-neutral-200 rounded-2xl bg-neutral-50 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all text-neutral-800 font-medium outline-none appearance-none cursor-pointer"
                     value={localSelection}
                     onChange={e => setLocalSelection(e.target.value)}
                     style={{ WebkitAppearance: 'none' }}
                   >
                     <option value="" disabled>Select a target...</option>
                     {aliveTargets.map(tgt => (
                       <option key={tgt.id} value={tgt.id}>{tgt.name}</option>
                     ))}
                   </select>
                   <button 
                     onClick={submitNightAction}
                     disabled={!localSelection}
                     className="w-full py-4 bg-indigo-900 text-white font-bold rounded-2xl disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none shadow hover:bg-black transition-all active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-indigo-100"
                   >
                     Confirm Target
                   </button>
                 </div>
               ) : (
                 <button 
                  onClick={submitNightAction}
                  className="w-full py-4 bg-neutral-800 text-white font-bold rounded-2xl shadow hover:bg-neutral-900 transition-all active:scale-[0.98] outline-none focus:ring-4 focus:ring-neutral-200"
                 >
                   Go to Sleep
                 </button>
               )}
             </div>
          ) : (
             <div className="w-full bg-neutral-50 border border-neutral-200 text-neutral-400 p-8 rounded-3xl text-center flex flex-col items-center">
               <Moon className="w-8 h-8 mb-3 opacity-40 animate-pulse" />
               <p className="font-medium tracking-wide">Waiting for other players...</p>
             </div>
          )}
        </div>
      )}

      {/* DAY SUMMARY PHASE */}
      {uiState.phase === 'DAY_SUMMARY' && (
        <div className="w-full flex flex-col space-y-4 animate-in fade-in">
          <div className="bg-amber-50 text-amber-950 p-6 sm:p-8 rounded-3xl shadow-sm border border-amber-200/50 flex items-center justify-between relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-3xl font-bold font-display tracking-tight mb-2 text-amber-900">Morning Arrives</h2>
              <p className="text-sm font-medium text-amber-700/80">The town wakes up to discover the events.</p>
            </div>
            <Sun className="w-16 h-16 text-amber-500/20 absolute -right-2 -top-2 transform rotate-12 z-0" />
            <Sun className="w-12 h-12 text-amber-500 relative z-10 drop-shadow-sm" />
          </div>

          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-neutral-200/60 flex flex-col gap-3">
             {uiState.myNightResult && (
               <div className="p-4 bg-indigo-50 text-indigo-900 rounded-2xl mb-2 font-medium border border-indigo-100 shadow-sm flex items-start gap-3">
                  <Search className="w-5 h-5 mt-0.5 text-indigo-500 flex-shrink-0" />
                  <p className="leading-relaxed">{uiState.myNightResult}</p>
               </div>
             )}
             <div className="space-y-3">
               {uiState.log.map((entry, idx) => (
                  <div key={idx} className="p-4 bg-neutral-50 text-neutral-800 rounded-2xl border border-neutral-200 leading-relaxed font-medium">
                    {entry}
                  </div>
               ))}
             </div>
          </div>

          {isHost && (
             <button 
               onClick={proceedToVoting}
               className="w-full py-4 bg-indigo-600 text-white font-bold text-lg rounded-2xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 active:scale-[0.98] transition-all"
             >
               Begin Voting Phase
             </button>
          )}
          {!isHost && (
             <p className="text-center text-neutral-400 mt-4 font-medium animate-pulse">Waiting for host to proceed...</p>
          )}
        </div>
      )}

      {/* VOTING PHASE */}
      {uiState.phase === 'VOTING' && (
        <div className="w-full flex flex-col space-y-4 animate-in fade-in">
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm text-center border border-neutral-200/60 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
            <h2 className="text-3xl font-display font-bold text-neutral-900 tracking-tight">Town Meeting</h2>
            <p className="text-neutral-500 mt-3 text-sm font-medium leading-relaxed">Discuss and vote for someone to eliminate.<br/>Tie votes result in no elimination.</p>
          </div>

          {!amIAlive ? (
            <div className="p-6 text-center text-neutral-500 bg-neutral-100 rounded-3xl border border-neutral-200 font-medium font-mono text-sm uppercase tracking-widest shadow-inner">
              Dead players cannot vote
            </div>
          ) : !hasSubmittedLocalAction ? (
             <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-neutral-200/60">
               <h3 className="font-bold text-neutral-800 mb-5 uppercase text-xs tracking-widest flex items-center gap-2"><User className="w-4 h-4 text-indigo-500" /> Cast Your Vote</h3>
               <div className="space-y-3 mb-6">
                 <label className={`flex items-center gap-4 p-4 border-2 rounded-2xl cursor-pointer transition-all ${localSelection === 'SKIP' || localSelection === '' ? 'border-indigo-600 bg-indigo-50/50' : 'border-neutral-200 bg-neutral-50 hover:border-indigo-200'}`}>
                   <input type="radio" className="w-5 h-5 accent-indigo-600" name="vote" value="SKIP" checked={localSelection === 'SKIP' || localSelection === ''} onChange={e => setLocalSelection(e.target.value)} />
                   <span className="font-bold text-neutral-900 tracking-tight">Skip Vote</span>
                 </label>
                 {aliveTargets.map(tgt => (
                    <label key={tgt.id} className={`flex items-center gap-4 p-4 border-2 rounded-2xl cursor-pointer transition-all ${localSelection === tgt.id ? 'border-indigo-600 bg-indigo-50/50' : 'border-neutral-200 bg-neutral-50 hover:border-indigo-200'}`}>
                      <input type="radio" className="w-5 h-5 accent-indigo-600" name="vote" value={tgt.id} checked={localSelection === tgt.id} onChange={e => setLocalSelection(e.target.value)} />
                      <span className="font-bold text-neutral-900 tracking-tight">{tgt.name}</span>
                    </label>
                 ))}
               </div>
               <button 
                  onClick={submitVoteAction}
                  className="w-full py-4 bg-indigo-600 text-white font-bold text-lg rounded-2xl shadow-lg shadow-indigo-600/20 hover:bg-neutral-900 transition-all active:scale-[0.98]"
               >
                 Submit Vote
               </button>
             </div>
          ) : (
            <div className="w-full bg-neutral-50 border border-neutral-200 text-neutral-400 p-8 rounded-3xl text-center flex flex-col items-center">
              <User className="w-8 h-8 mb-3 opacity-40 animate-pulse" />
              <p className="font-medium tracking-wide">Waiting for other players to vote...</p>
            </div>
          )}
        </div>
      )}

      {/* LYNCH RESULT PHASE */}
      {uiState.phase === 'LYNCH_RESULT' && (
        <div className="w-full flex flex-col space-y-4 animate-in zoom-in-95 duration-300">
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-lg text-center border-t-8 border-rose-600 relative overflow-hidden flex flex-col items-center">
            <Skull className="w-12 h-12 text-rose-100 absolute -right-2 -bottom-2 transform rotate-12" />
            <h2 className="text-4xl font-display font-black text-neutral-900 uppercase tracking-tight mb-6">The Verdict</h2>
            <p className="text-xl text-neutral-700 font-medium leading-relaxed relative z-10">{uiState.lynchResultInfo?.message}</p>
          </div>

          {isHost && (
             <button 
               onClick={proceedToNight}
               className="w-full py-4 bg-indigo-950 text-indigo-50 font-bold text-lg rounded-2xl shadow-lg hover:bg-indigo-900 transition-all flex justify-center gap-2 items-center active:scale-[0.98]"
             >
               <Moon className="w-5 h-5"/> Go to Sleep
             </button>
          )}
          {!isHost && (
            <p className="text-center text-neutral-400 mt-4 font-medium animate-pulse">Waiting for host...</p>
          )}
        </div>
      )}

      {/* GAME OVER PHASE */}
      {uiState.phase === 'GAME_OVER' && (
        <div className="w-full flex flex-col space-y-4 animate-in slide-in-from-bottom duration-500">
          {uiState.lynchResultInfo && (
            <div className="bg-white p-5 rounded-3xl shadow-sm text-center mb-2 border border-neutral-200/60 tracking-wide font-medium text-neutral-600">
              {uiState.lynchResultInfo.message}
            </div>
          )}
          <div className={`p-8 sm:p-10 rounded-[2rem] shadow-xl text-center transform scale-100 ${uiState.winnerInfo?.winner === 'TOWN' ? 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white' : uiState.winnerInfo?.winner === 'MURDERER' ? 'bg-gradient-to-br from-rose-600 to-red-900 text-white' : 'bg-gradient-to-br from-indigo-500 to-violet-800 text-white'}`}>
            <h2 className="text-4xl font-display font-black mb-3 tracking-tighter uppercase drop-shadow-md">Game Over</h2>
            <p className="text-2xl font-bold opacity-90 leading-tight">
              {uiState.winnerInfo?.message}
            </p>
          </div>

          {/* Reveal all roles */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-200/60 mt-2">
            <h3 className="font-bold text-neutral-800 text-center mb-5 uppercase tracking-widest text-sm">Final Roles</h3>
            <div className="space-y-3">
              {uiState.players.map(p => (
                <div key={p.id} className="flex justify-between items-center p-3 sm:p-4 rounded-2xl bg-neutral-50 border border-neutral-100">
                  <span className={`font-bold tracking-tight ${p.isAlive ? 'text-neutral-900' : 'text-neutral-400 line-through decoration-neutral-400/50'}`}>{p.name}</span>
                  <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full ${
                    p.role === 'MURDERER' ? 'bg-rose-100 text-rose-700' :
                    p.role === 'DETECTIVE' ? 'bg-indigo-100 text-indigo-700' :
                    p.role === 'SHERIFF' ? 'bg-emerald-100 text-emerald-700' :
                    p.role === 'JESTER' ? 'bg-violet-100 text-violet-700' : 'bg-neutral-200 text-neutral-600'
                  }`}>{ROLE_NAMES[p.role]}</span>
                </div>
              ))}
            </div>
          </div>

          {isHost && (
             <button 
               onClick={restartGame}
               className="w-full py-4 mt-4 bg-neutral-900 text-white font-bold text-lg rounded-2xl shadow-lg hover:bg-black transition-all active:scale-[0.98]"
             >
               Back to Setup
             </button>
          )}
        </div>
      )}
    </div>
  );
}
