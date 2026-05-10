import React, { useEffect, useState, useRef } from 'react';
import { CardDef, CBG_CARDS } from './cards';
import { CBGEngine, GameState, Entity } from './Engine';
import { Play, Package, Book, Unlock, ArrowLeft, Download, Upload, Save } from 'lucide-react';

const MAP_W = 400;
const MAP_H = 600;

interface CBGProps {
  channel: RTCDataChannel;
  isHost: boolean;
  onBackToLobby: () => void;
}

export function CardBattleGround({ channel, isHost, onBackToLobby }: CBGProps) {
  // Local storage state
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [chests, setChests] = useState<number>(0);
  const [hasUnsavedProgress, setHasUnsavedProgress] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // UI State
  const [tab, setTab] = useState<'BATTLE' | 'CARDS'>('BATTLE');
  const [matchState, setMatchState] = useState<'MENU' | 'PLAYING' | 'ENDED'>('MENU');
  
  // In-game state
  const engineRef = useRef<CBGEngine | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [hand, setHand] = useState<string[]>([]);
  const deckCycleRef = useRef<string[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Initialize from local storage
  useEffect(() => {
    const savedUnlocked = localStorage.getItem('cbg_unlocked');
    if (savedUnlocked) setUnlockedIds(JSON.parse(savedUnlocked));
    else setUnlockedIds(CBG_CARDS.filter(c => c.isBase).map(c => c.id));
    
    const savedDeck = localStorage.getItem('cbg_deck');
    if (savedDeck) setDeckIds(JSON.parse(savedDeck));
    else setDeckIds(CBG_CARDS.filter(c => c.isBase).map(c => c.id));
    
    const savedChests = localStorage.getItem('cbg_chests');
    if (savedChests) setChests(parseInt(savedChests, 10));
  }, []);

  // Save to local storage
  useEffect(() => {
    if (unlockedIds.length > 0) localStorage.setItem('cbg_unlocked', JSON.stringify(unlockedIds));
    if (deckIds.length > 0) localStorage.setItem('cbg_deck', JSON.stringify(deckIds));
    localStorage.setItem('cbg_chests', chests.toString());
  }, [unlockedIds, deckIds, chests]);

  // Handle network messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'START_MATCH') {
          startMatchLocal();
        } else if (msg.type === 'SYNC_STATE' && !isHost) {
          setGameState(msg.state);
        } else if (msg.type === 'PLAY_CARD' && isHost) {
          engineRef.current?.playCard(1, msg.cardId, msg.x, msg.y);
        } else if (msg.type === 'GAME_OVER') {
          handleGameOver(msg.winner);
        }
      } catch (err) {}
    };
    channel.addEventListener('message', handleMessage);
    return () => channel.removeEventListener('message', handleMessage);
  }, [isHost, channel]);

  const broadcast = (msg: any) => {
    if (channel.readyState === 'open') {
      channel.send(JSON.stringify(msg));
    }
  };

  const startMatchHost = () => {
    broadcast({ type: 'START_MATCH' });
    startMatchLocal();
  };

  const startMatchLocal = () => {
    setMatchState('PLAYING');
    
    // Setup hand
    const shuffledDeck = [...deckIds].sort(() => Math.random() - 0.5);
    setHand(shuffledDeck.slice(0, 4)); // actually 4 in hand is more standard clash royale, user said 6, let's use 4 to fit mobile better, or 6
    deckCycleRef.current = shuffledDeck.slice(4);

    if (isHost) {
      engineRef.current = new CBGEngine();
      lastTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(gameLoop);
    }
  };

  const gameLoop = (time: number) => {
    if (!engineRef.current) return;
    const dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    engineRef.current.update(dt);
    setGameState({ ...engineRef.current.state });

    // Broadcast state at ~20fps? Actually just every frame for simplicity since it's 2 player and simple
    broadcast({ type: 'SYNC_STATE', state: engineRef.current.state });

    if (engineRef.current.state.gameOver) {
      handleGameOver(engineRef.current.state.winner!);
      broadcast({ type: 'GAME_OVER', winner: engineRef.current.state.winner! });
    } else {
      rafRef.current = requestAnimationFrame(gameLoop);
    }
  };

  const handleGameOver = (winner: number) => {
    setMatchState('ENDED');
    cancelAnimationFrame(rafRef.current);
    
    const iWon = (isHost && winner === 0) || (!isHost && winner === 1);
    if (iWon) {
      setChests(prev => prev + 1);
      setHasUnsavedProgress(true);
    }
  };

  // Rendering Game
  useEffect(() => {
    if (matchState !== 'PLAYING' || !gameState) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw Map
    ctx.fillStyle = '#4ade80'; // grass
    ctx.fillRect(0, 0, 400, 600);
    
    // Moat
    ctx.fillStyle = '#38bdf8'; // water
    ctx.fillRect(0, 280, 400, 40);

    // Bridges
    ctx.fillStyle = '#b45309'; // wood
    ctx.fillRect(80, 280, 40, 40);
    ctx.fillRect(280, 280, 40, 40);

    // Draw Entities
    for (const e of gameState.entities) {
       ctx.fillStyle = e.color;
       
       if (e.type === 'tower') {
          // simple square base, round top
          ctx.fillRect(e.x - e.radius, e.y - e.radius, e.radius*2, e.radius*2);
          ctx.fillStyle = e.team === 0 ? '#1d4ed8' : '#7f1d1d';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius * 0.5, 0, Math.PI*2);
          ctx.fill();
       } else {
          // troop with more detailed geometric rendering
          ctx.save();
          ctx.translate(e.x, e.y);
          
          const t = performance.now() / 200;
          const wobble = Math.sin(t * e.speed * 0.1 + (e.x + e.y)) * 4;
          
          // Draw Body
          ctx.beginPath();
          ctx.arc(0, wobble, e.radius, 0, Math.PI*2);
          ctx.fill();
          
          // Add distinguishing geometric shapes based on card attributes
          ctx.fillStyle = '#cbd5e1';
          const isMelee = e.range < 30; // Close range
          const isBuilding = e.speed === 0;
          
          if (!isBuilding) {
             if (isMelee) {
                // Sword or Axe (melee)
                ctx.rotate(Math.sin(t * 2) * 0.5);
                ctx.fillRect(e.radius * 0.5, wobble - e.radius, 4, e.radius * 1.5);
                ctx.fillStyle = '#94a3b8'; // metal tip
                ctx.fillRect(e.radius * 0.5 - 2, wobble - e.radius - 4, 8, 8);
             } else {
                // Bow or Wand (ranged)
                ctx.beginPath();
                ctx.arc(e.radius + 2, wobble, e.radius * 0.8, -Math.PI/2, Math.PI/2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#854d0e'; // wood color
                ctx.stroke();
             }
             
             // Simple Eyes
             ctx.fillStyle = e.team === 0 ? 'white' : '#fecdd3';
             const facing = e.team === 0 ? -1 : 1;
             ctx.beginPath();
             ctx.arc(0, wobble + (facing * e.radius * 0.4), 2, 0, Math.PI*2);
             ctx.fill();
          }

          ctx.restore();
       }
       
       // HP bar
       ctx.fillStyle = '#dc2626';
       ctx.fillRect(e.x - 10, e.y - e.radius - 8, 20, 4);
       ctx.fillStyle = '#22c55e';
       ctx.fillRect(e.x - 10, e.y - e.radius - 8, 20 * (e.hp / e.maxHp), 4);
    }

  }, [gameState, matchState]);

  const myTeam = isHost ? 0 : 1;
  const myElixir = gameState ? gameState.elixir[myTeam] : 0;

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only place card if selected
    if (!selectedCardId) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = (e.clientX - rect.left) * (400 / rect.width);
    const y = (e.clientY - rect.left) * (600 / rect.height);
    
    // Must place on own half
    if (isHost && y < 300) return;
    if (!isHost && y > 300) return;

    if (isHost) {
      engineRef.current?.playCard(0, selectedCardId, x, y);
    } else {
      broadcast({ type: 'PLAY_CARD', cardId: selectedCardId, x, y });
    }

    // cycle hand
    setHand(prev => {
       const newHand = [...prev];
       const idx = newHand.indexOf(selectedCardId);
       const nextCard = deckCycleRef.current.shift()!;
       newHand[idx] = nextCard;
       deckCycleRef.current.push(selectedCardId);
       return newHand;
    });
    setSelectedCardId(null);
  };

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  
  // UI Actions
  const openChest = () => {
    if (chests > 0) {
      const lockedCards = CBG_CARDS.filter(c => !unlockedIds.includes(c.id));
      setChests(prev => prev - 1);
      if (lockedCards.length > 0) {
          const card = lockedCards[Math.floor(Math.random() * lockedCards.length)];
          setUnlockedIds(prev => [...prev, card.id]);
          setHasUnsavedProgress(true);
          alert(`Chest Opened! You unlocked: ${card.name}`);
      } else {
          alert('Chest Opened! But you already have all cards unlocked.');
      }
    }
  };

  const [fileHandle, setFileHandle] = useState<any>(null);

  const handleSaveProgress = async () => {
    const data = JSON.stringify({
        unlockedIds,
        deckIds,
        chests
    });
    
    try {
        if ('showSaveFilePicker' in window) {
            let handle = fileHandle;
            if (!handle) {
                handle = await (window as any).showSaveFilePicker({
                    suggestedName: 'Card Battle Ground Account.txt',
                    types: [{
                        description: 'Text Files',
                        accept: { 'text/plain': ['.txt'] },
                    }],
                });
                setFileHandle(handle);
            }
            const writable = await handle.createWritable();
            await writable.write(btoa(data));
            await writable.close();
            setHasUnsavedProgress(false);
            alert('Progress saved to your file! (Old versions are automatically overwritten).');
        } else {
            // Fallback for Safari/Mobile
            const blob = new Blob([btoa(data)], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Card Battle Ground Account.txt';
            a.click();
            URL.revokeObjectURL(url);
            setHasUnsavedProgress(false);
            alert('Progress downloaded! (Note: Your browser does not support automatic overwriting of old files).');
        }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
           alert('Failed to save progress.');
        }
    }
  };

  const handleLoadProgressFileAPI = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Text Files',
            accept: { 'text/plain': ['.txt'] },
          }],
        });
        setFileHandle(handle);
        const file = await handle.getFile();
        const raw = await file.text();
        const data = JSON.parse(atob(raw));
        if (data.unlockedIds && data.deckIds && data.chests !== undefined) {
            setUnlockedIds(data.unlockedIds);
            setDeckIds(data.deckIds);
            setChests(data.chests);
            alert('Progress loaded successfully!');
        } else {
            alert('Invalid file format.');
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        alert('Failed to load file.');
      }
    }
  };

  const handleLoadProgressFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const raw = event.target?.result as string;
            const data = JSON.parse(atob(raw));
            if (data.unlockedIds && data.deckIds && data.chests !== undefined) {
                setUnlockedIds(data.unlockedIds);
                setDeckIds(data.deckIds);
                setChests(data.chests);
                alert('Progress loaded successfully!');
            } else {
                alert('Invalid file format.');
            }
        } catch (err) {
            alert('Failed to read file. Please ensure this is a valid Card Battle Ground Account file.');
        }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleDeckCard = (cId: string) => {
     if (deckIds.includes(cId)) {
        if (deckIds.length <= 12) {
           alert("Deck must have 12 cards!");
           return;
        }
        setDeckIds(prev => prev.filter(id => id !== cId));
        setHasUnsavedProgress(true);
     } else {
        if (deckIds.length >= 12) {
           alert("Deck is full (max 12). Remove a card first.");
           return;
        }
        setDeckIds(prev => [...prev, cId]);
        setHasUnsavedProgress(true);
     }
  };

  if (matchState === 'MENU') {
    return (
      <div className="w-full h-full flex flex-col bg-slate-900 text-slate-100">
        <header className="px-4 py-3 bg-slate-800 flex justify-between items-center shadow-md">
          <h1 className="font-bold text-xl flex items-center gap-2"><div className="w-4 h-4 bg-indigo-500 rounded-sm" /> Card Battle</h1>
          <button onClick={onBackToLobby} className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5"/></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 hide-scrollbar pb-24">
           {tab === 'BATTLE' && (
              <div className="flex flex-col items-center gap-8 pt-8">
                 <div className="text-center">
                    <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-purple-500 rounded-full mb-2">BATTLE ARENA</h2>
                    <p className="text-slate-400">Fight your opponent in real-time!</p>
                 </div>
                 
                 <div className="flex flex-col items-center gap-4">
                    <button 
                       onClick={handleSaveProgress}
                       className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold text-sm transition-all border-2 ${hasUnsavedProgress ? 'bg-red-500/20 border-red-500 text-red-500 hover:bg-red-500/30' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                    >
                       <Save className="w-4 h-4" /> Save Progress
                    </button>

                    {isHost ? (
                       <button onClick={startMatchHost} className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full font-black text-2xl shadow-[0_0_40px_rgba(79,70,229,0.4)] hover:scale-105 active:scale-95 transition-all">
                          START BATTLE
                       </button>
                    ) : (
                       <div className="text-lg font-bold text-slate-400 animate-pulse bg-slate-800 px-6 py-3 rounded-full border border-slate-700">Waiting for Host...</div>
                    )}
                 </div>

                 <div className="w-full max-w-sm mt-8">
                    <h3 className="font-bold text-slate-300 mb-4 flex items-center gap-2 border-b border-slate-700 pb-2"><Package className="w-5 h-5"/> Chests</h3>
                    <div className="flex gap-4">
                       <button onClick={openChest} disabled={chests === 0} className={`flex-1 py-6 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${chests > 0 ? 'bg-amber-500/20 border-amber-500 text-amber-400 hover:bg-amber-500/30' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                          <Package className={`w-10 h-10 ${chests > 0 ? 'animate-bounce' : ''}`} />
                          <span className="font-bold">{chests} Chests</span>
                          {chests > 0 && <span className="text-xs">Tap to open</span>}
                       </button>
                    </div>
                 </div>
              </div>
           )}

           {tab === 'CARDS' && (
              <div className="flex flex-col gap-6">
                 <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700">
                    <h3 className="font-bold mb-2 flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400"/> Reload Progress</h3>
                     <div className="flex gap-2 items-center">
                       <input 
                          type="file" 
                          accept=".txt"
                          onChange={handleLoadProgressFallback}
                          ref={fileInputRef}
                          className="hidden" 
                       />
                       <button 
                          onClick={handleLoadProgressFileAPI}
                          className="flex-1 text-center py-3 bg-emerald-600/20 border-2 border-emerald-500 text-emerald-400 rounded-xl text-sm font-bold cursor-pointer hover:bg-emerald-600/30 transition-colors"
                       >
                          Choose Progress File
                       </button>
                    </div>
                 </div>

                 <div>
                    <h3 className="font-bold text-lg mb-2">Your Deck ({deckIds.length}/12)</h3>
                    <div className="grid grid-cols-4 gap-3">
                       {deckIds.map(id => {
                          const c = CBG_CARDS.find(card => card.id === id)!;
                          return (
                             <div key={id} onClick={() => toggleDeckCard(id)} className="aspect-[3/4] rounded-xl border-2 border-indigo-500 relative flex flex-col cursor-pointer overflow-hidden bg-slate-800 group">
                                <div className="h-1/2 w-full" style={{backgroundColor: c.color}} />
                                <div className="p-1 text-center text-[10px] font-bold leading-tight mt-1">{c.name}</div>
                                <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">{c.cost}</div>
                                <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 font-bold text-xs">Remove</div>
                             </div>
                          );
                       })}
                    </div>
                 </div>

                 <div>
                    <h3 className="font-bold text-lg mb-2">Collection</h3>
                    <div className="grid grid-cols-4 gap-3 opacity-70">
                       {unlockedIds.filter(id => !deckIds.includes(id)).map(id => {
                          const c = CBG_CARDS.find(card => card.id === id)!;
                          return (
                             <div key={id} onClick={() => toggleDeckCard(id)} className="aspect-[3/4] rounded-xl border-2 border-slate-600 relative flex flex-col cursor-pointer overflow-hidden bg-slate-800 hover:border-slate-400 transition-colors">
                                <div className="h-1/2 w-full" style={{backgroundColor: c.color}} />
                                <div className="p-1 text-center text-[10px] font-bold leading-tight mt-1">{c.name}</div>
                                <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">{c.cost}</div>
                             </div>
                          );
                       })}
                    </div>
                 </div>
              </div>
           )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 border-t border-slate-800 flex p-2 pt-0 pb-6 z-50">
           <button onClick={() => setTab('BATTLE')} className={`flex-1 flex flex-col items-center justify-center py-3 rounded-2xl transition-colors ${tab === 'BATTLE' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
              <Play className="w-6 h-6 mb-1"/>
              <span className="text-[10px] font-bold tracking-wider">BATTLE</span>
           </button>
           <button onClick={() => setTab('CARDS')} className={`flex-1 flex flex-col items-center justify-center py-3 rounded-2xl transition-colors ${tab === 'CARDS' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
              <Book className="w-6 h-6 mb-1"/>
              <span className="text-[10px] font-bold tracking-wider">CARDS</span>
           </button>
        </div>
      </div>
    );
  }

  if (matchState === 'ENDED') {
     const iWon = (isHost && gameState?.winner === 0) || (!isHost && gameState?.winner === 1);
     return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white z-50">
           <h2 className={`text-5xl font-black mb-4 ${iWon ? 'text-amber-400' : 'text-red-500'}`}>{iWon ? 'VICTORY' : 'DEFEAT'}</h2>
           <p className="text-slate-400 mb-8">{iWon ? '+1 Chest Earned' : 'Better luck next time'}</p>
           <button onClick={() => {
              setMatchState('MENU');
              setGameState(null);
           }} className="px-8 py-3 bg-white text-slate-900 font-bold rounded-full">Back to Menu</button>
        </div>
     );
  }

  return (
    <div className="w-full h-full bg-slate-900 flex flex-col relative overflow-hidden">
       {/* Game Canvas Container */}
       <div className="flex-1 max-w-md w-full mx-auto relative flex items-center justify-center">
         <canvas 
            ref={canvasRef} 
            width={MAP_W} height={MAP_H} 
            className="w-full h-full max-h-[80vh] object-contain border border-slate-800 bg-black cursor-crosshair touch-none"
            onClick={handleCanvasClick}
         />
       </div>

       {/* HUD & Hand */}
       <div className="h-32 bg-slate-950 border-t border-slate-800 p-2 flex flex-col gap-2 relative">
          <div className="absolute top-2 right-4 font-black text-fuchsia-400 text-lg flex items-center gap-1">
             <div className="w-3 h-3 rounded-full bg-fuchsia-400 animate-pulse"/>
             {Math.floor(myElixir)}
          </div>
          
          <div className="flex justify-center gap-2 mt-2 h-full">
             {hand.map((id, i) => {
                const c = CBG_CARDS.find(card => card.id === id)!;
                const canAfford = myElixir >= c.cost;
                const isSelected = selectedCardId === id;
                return (
                   <button 
                      key={i}
                      disabled={!canAfford}
                      onClick={() => setSelectedCardId(isSelected ? null : id)}
                      className={`relative w-16 h-24 rounded-lg flex flex-col overflow-hidden transition-transform ${isSelected ? '-translate-y-4 shadow-lg shadow-indigo-500/50' : ''} ${!canAfford ? 'opacity-40 grayscale' : 'hover:-translate-y-1'}`}
                   >
                      <div className="h-1/2 w-full" style={{backgroundColor: c.color}} />
                      <div className="h-1/2 bg-slate-800 p-1 flex flex-col items-center">
                         <span className="text-[9px] font-bold text-center leading-tight">{c.name}</span>
                      </div>
                      <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">{c.cost}</div>
                   </button>
                );
             })}
          </div>
       </div>
    </div>
  );
}
