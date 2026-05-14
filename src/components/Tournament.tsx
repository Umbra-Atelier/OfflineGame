import React, { useEffect, useState, useMemo } from 'react';
import { GameType, GameMessage } from '../types';
import { TapWar } from './games/TapWar';
import { Pong } from './games/Pong';
import { ChessGame } from './games/ChessGame';
import { CardBattleGround } from './games/cbg/CardBattleGround';
import { RocketLeague } from './games/RocketLeague';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ChevronRight, Swords } from 'lucide-react';

interface PlayerInfo {
  id: string;
  name: string;
}

interface Match {
  id: string;
  p1Id: string;
  p1Name: string;
  p2Id: string;
  p2Name: string;
  winnerId: string | null;
}

interface TournamentState {
  rounds: Match[][];
  currentRoundIndex: number;
  isComplete: boolean;
}

interface TournamentProps {
  gameType: GameType;
  myId: string;
  myName: string;
  players: PlayerInfo[];
  isGlobalHost: boolean;
  channelsRef: React.MutableRefObject<Map<string, RTCDataChannel>>;
  onBackToLobby: () => void;
}

export class VirtualDataChannel extends EventTarget {
  readyState = 'open';
  constructor(private sendCallback: (data: string) => void) {
    super();
  }
  send(data: string) {
    this.sendCallback(data);
  }
}

export function Tournament({ gameType, myId, myName, players, isGlobalHost, channelsRef, onBackToLobby }: TournamentProps) {
  const [tState, setTState] = useState<TournamentState | null>(null);
  const [showingBracket, setShowingBracket] = useState(true);

  // Generate round robin rounds (circle method)
  useEffect(() => {
    if (isGlobalHost && !tState) {
      const p = [...players];
      if (p.length % 2 !== 0) {
        p.push({ id: 'BYE', name: 'BYE' });
      }
      const numRounds = p.length - 1;
      const half = p.length / 2;
      const rounds: Match[][] = [];

      const circle = [...p];
      for (let r = 0; r < numRounds; r++) {
         const roundObj: Match[] = [];
         for (let i = 0; i < half; i++) {
            const p1 = circle[i];
            const p2 = circle[circle.length - 1 - i];
            if (p1.id !== 'BYE' && p2.id !== 'BYE') {
               roundObj.push({
                 id: `match-${r}-${i}`,
                 p1Id: p1.id,
                 p1Name: p1.name,
                 p2Id: p2.id,
                 p2Name: p2.name,
                 winnerId: null,
               });
            }
         }
         rounds.push(roundObj);
         // Rotate circle, keeping first fixed
         const first = circle[0];
         const rest = circle.slice(1);
         circle.length = 0;
         circle.push(first, rest[rest.length - 1], ...rest.slice(0, rest.length - 1));
      }

      const initial = { rounds, currentRoundIndex: 0, isComplete: false };
      setTState(initial);
      broadcast({ type: 'T_STATE', payload: initial });
    }
  }, [isGlobalHost, players, tState]);

  const broadcast = (msg: any) => {
    const msgStr = JSON.stringify(msg);
    channelsRef.current.forEach(c => {
      if (c.readyState === 'open') c.send(msgStr);
    });
  };

  // Handle incoming tournament messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'T_STATE') {
          setTState(msg.payload);
        } else if (msg.type === 'T_START_MATCH') {
          setShowingBracket(false);
        } else if (msg.type === 'T_MATCH_WIN') {
          if (isGlobalHost) {
            setTState(prev => {
              if (!prev) return prev;
              const next = { ...prev };
              
              // find match and set winner
              let roundComplete = true;
              for (const m of next.rounds[next.currentRoundIndex]) {
                 if (m.id === msg.matchId) {
                    m.winnerId = msg.winnerId;
                 }
                 if (!m.winnerId) roundComplete = false;
              }

              if (roundComplete) {
                if (next.currentRoundIndex + 1 < next.rounds.length) {
                  next.currentRoundIndex++;
                  setShowingBracket(true);
                } else {
                  next.isComplete = true;
                  setShowingBracket(true);
                }
              }
              broadcast({ type: 'T_STATE', payload: next });
              return next;
            });
          }
        } else if (msg.type === 'T_RELAY') {
          if (isGlobalHost && msg.toId) {
            const target = channelsRef.current.get(msg.toId);
            if (target && target.readyState === 'open') {
              target.send(JSON.stringify(msg.payload));
            }
          }
        }
      } catch (err) {}
    };

    channelsRef.current.forEach(c => c.addEventListener('message', handleMessage));
    return () => {
      channelsRef.current.forEach(c => c.removeEventListener('message', handleMessage));
    };
  }, [isGlobalHost, channelsRef]);

  if (!tState) return <div className="text-center p-8">Setting up tournament...</div>;

  const currentRoundMatches = tState.rounds[tState.currentRoundIndex] || [];
  const myMatch = currentRoundMatches.find(m => m.p1Id === myId || m.p2Id === myId);
  const amInMatch = !!myMatch;

  const vc = useMemo(() => {
    if (!myMatch) return null;
    return new VirtualDataChannel((data: string) => {
      const parsed = JSON.parse(data);
      const toId = myId === myMatch.p1Id ? myMatch.p2Id : myMatch.p1Id;
      
      if (toId === 'host') {
         const c = channelsRef.current.get('host');
         if (c) c.send(data);
      } else if (myId === 'host') {
         const c = channelsRef.current.get(toId);
         if (c) c.send(data);
      } else {
         const c = channelsRef.current.get('host'); 
         if (c) c.send(JSON.stringify({ type: 'T_RELAY', toId, payload: parsed }));
      }
    });
  }, [myMatch, myId, channelsRef, gameType]);

  useEffect(() => {
    const handleGameMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'GAME_MESSAGE' && msg.game === gameType && myMatch) { 
            vc?.dispatchEvent(new MessageEvent('message', { data: e.data }));
        } else if (msg.type === 'T_RELAY' && !isGlobalHost) { 
            vc?.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg.payload) }));
        }
      } catch (err) {}
    };
    channelsRef.current.forEach(c => c.addEventListener('message', handleGameMessage));
    return () => {
       channelsRef.current.forEach(c => c.removeEventListener('message', handleGameMessage));
    };
  }, [vc, channelsRef, isGlobalHost, gameType, myMatch]);

  const startMatch = () => {
    if (isGlobalHost) {
      setShowingBracket(false);
      broadcast({ type: 'T_START_MATCH' });
    }
  };

  const declareMatchWin = (matchId: string, winnerId: string) => {
    const msg = { type: 'T_MATCH_WIN', matchId, winnerId };
    if (isGlobalHost) {
        setTState(prev => {
          if (!prev) return prev;
          const next = { ...prev };
          
          let roundComplete = true;
          for (const m of next.rounds[next.currentRoundIndex]) {
             if (m.id === msg.matchId) {
                m.winnerId = msg.winnerId;
             }
             if (!m.winnerId) roundComplete = false;
          }

          if (roundComplete) {
            if (next.currentRoundIndex + 1 < next.rounds.length) {
              next.currentRoundIndex++;
              setShowingBracket(true);
            } else {
              next.isComplete = true;
              setShowingBracket(true);
            }
          }
          broadcast({ type: 'T_STATE', payload: next });
          return next;
        });
    } else {
        channelsRef.current.get('host')?.send(JSON.stringify(msg));
    }
  };

  if (showingBracket) {
     return (
        <div className="flex flex-col items-center p-6 bg-slate-50 w-full min-h-full">
           <h2 className="text-3xl font-display font-bold text-slate-800 mb-8 flex items-center gap-3">
             <Trophy className="w-8 h-8 text-amber-500" />
             Tournament Bracket
           </h2>
           
           <div className="w-full flex justify-center pb-8 border-b-2">
              <h3 className="text-xl font-bold text-slate-500">Round {tState.currentRoundIndex + 1}</h3>
           </div>

           <div className="w-full max-w-4xl overflow-x-auto py-8 hide-scrollbar">
              <div className="flex gap-6 justify-center flex-wrap">
                 {currentRoundMatches.map((m, idx) => {
                    const isComplete = m.winnerId != null;
                    return (
                       <div key={m.id} className={`w-72 bg-white rounded-2xl shadow-sm border-2 p-5 transition-all duration-300 ${!isComplete ? 'border-indigo-500 shadow-md shadow-indigo-100' : 'border-slate-200 opacity-80'}`}>
                          <div className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-4 text-center">Match {idx + 1}</div>
                          <div className="flex flex-col gap-3 items-center">
                             <div className={`w-full text-center p-4 rounded-xl font-bold bg-slate-50 border shadow-sm ${m.winnerId === m.p1Id ? 'border-green-400 text-green-700 bg-green-50' : m.winnerId ? 'border-red-200 text-slate-500' : 'border-slate-100 text-slate-700'}`}>
                                {m.p1Name} {m.winnerId === m.p1Id && '🏆'}
                             </div>
                             <Swords className="w-6 h-6 text-slate-300" />
                             <div className={`w-full text-center p-4 rounded-xl font-bold bg-slate-50 border shadow-sm ${m.winnerId === m.p2Id ? 'border-green-400 text-green-700 bg-green-50' : m.winnerId ? 'border-red-200 text-slate-500' : 'border-slate-100 text-slate-700'}`}>
                                {m.p2Name} {m.winnerId === m.p2Id && '🏆'}
                             </div>
                          </div>
                       </div>
                    );
                 })}
              </div>
           </div>

           <div className="mt-8 text-center min-h-[50px]">
              {tState.isComplete ? (
                 <div className="animate-in fade-in slide-in-from-bottom">
                    <h3 className="text-2xl font-bold text-slate-800 mb-4">Tournament Complete!</h3>
                    <button onClick={onBackToLobby} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-bold text-lg shadow-lg hover:bg-slate-800 transition-all">Back to Lobby</button>
                 </div>
              ) : isGlobalHost && currentRoundMatches.every(m => !m.winnerId) ? (
                  <button onClick={startMatch} className="w-64 bg-indigo-600 text-white font-bold py-4 rounded-2xl text-lg shadow-sm hover:bg-indigo-700 active:scale-95 transition-all">Start Round</button>
              ) : (
                  <span className="text-sm text-indigo-500 font-bold animate-pulse">
                     {currentRoundMatches.every(m => m.winnerId) ? 'Waiting for host...' : 'Round in progress...'}
                  </span>
              )}
           </div>
           
           {!tState.isComplete && (
              <button onClick={onBackToLobby} className="mt-12 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">Emergency Quit</button>
           )}
        </div>
     );
  }

  const isGameHost = myMatch ? myId === myMatch.p1Id : false;

  return (
    <div className="w-full h-full relative">
       {amInMatch ? (
          <>
             <div className="absolute top-2 left-0 right-0 z-50 pointer-events-none flex justify-center">
                <span className="bg-white/90 backdrop-blur px-4 py-1.5 rounded-full text-xs font-bold text-slate-600 shadow-sm border border-slate-200">
                   Active Game: {myMatch.p1Name} vs {myMatch.p2Name}
                </span>
             </div>
             {gameType === 'TAP_WAR' && <TapWar channel={vc as any} isHost={isGameHost} onBackToLobby={() => {}} />}
             {gameType === 'PONG' && <Pong channel={vc as any} isHost={isGameHost} onBackToLobby={() => {}} />}
             {gameType === 'CHESS' && <ChessGame channel={vc as any} isHost={isGameHost} onBackToLobby={() => {}} />}
             {gameType === 'CARD_BATTLE' && <CardBattleGround channel={vc as any} isHost={isGameHost} onBackToLobby={() => {}} />}
             {gameType === 'ROCKET_LEAGUE' && <RocketLeague channel={vc as any} isHost={isGameHost} onBackToLobby={() => {}} />}

             <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
                {(isGameHost || isGlobalHost) && (
                   <>
                      <button onClick={() => declareMatchWin(myMatch.id, myMatch.p1Id)} className="bg-indigo-600/80 hover:bg-indigo-600 backdrop-blur text-white text-xs px-3 py-2 rounded-xl font-bold">{myMatch.p1Name} Won</button>
                      <button onClick={() => declareMatchWin(myMatch.id, myMatch.p2Id)} className="bg-rose-500/80 hover:bg-rose-500 backdrop-blur text-white text-xs px-3 py-2 rounded-xl font-bold">{myMatch.p2Name} Won</button>
                   </>
                )}
             </div>
          </>
       ) : (
          <div className="flex flex-col items-center justify-center h-[70vh]">
             <h3 className="text-2xl font-bold text-slate-800 mb-2">Spectating</h3>
             <p className="text-lg text-slate-500 mb-8">Waiting for others to finish this round...</p>
             <div className="flex items-center justify-center p-8 bg-slate-100 rounded-3xl animate-pulse">
                <Swords className="w-12 h-12 text-slate-300" />
             </div>
          </div>
       )}
    </div>
  );
}
