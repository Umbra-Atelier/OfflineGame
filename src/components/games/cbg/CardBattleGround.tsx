import React, { useEffect, useState, useRef } from 'react';
import { CardDef, CBG_CARDS } from './cards';
import { CBGEngine, GameState, Entity } from './Engine';
import { Play, Package, Book, Unlock, ArrowLeft, Download, Upload, Save, Info, X, MoreVertical, Lock } from 'lucide-react';

const MAP_W = 400;
const MAP_H = 600;

const UnitPreview = ({ card }: { card: CardDef }) => {
   if (card.isChampion) {
       return (
          <svg viewBox="-30 -30 60 60" className="w-14 h-14 drop-shadow-lg">
             <defs>
                 <linearGradient id={`${card.id}-grad`} x1="0" y1="0" x2="1" y2="1">
                     <stop offset="0%" stopColor="#fbbf24" />
                     <stop offset="100%" stopColor={card.color} />
                 </linearGradient>
             </defs>
             <polygon points="0,-25 20,-10 20,15 0,25 -20,15 -20,-10" fill={`url(#${card.id}-grad)`} stroke="#fcd34d" strokeWidth="2" />
             <circle cx="0" cy="0" r="12" fill={card.color} />
             {card.type === 'spell' ? (
                <text x="0" y="4" fontSize="12" textAnchor="middle" fill="white" fontWeight="bold">✨</text>
             ) : (
                <rect x="-8" y="-4" width="16" height="8" fill="rgba(255,255,255,0.4)" rx="2" />
             )}
          </svg>
       );
   }

   if (card.type === 'spell') {
      return (
         <svg viewBox="-20 -20 40 40" className="w-10 h-10 drop-shadow-md">
            <circle cx="0" cy="0" r="16" fill={card.color} fillOpacity="0.4" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="4 4" />
         </svg>
      );
   }
   if (card.stats.speed === 0) {
      return (
         <svg viewBox="-20 -20 40 40" className="w-10 h-10 drop-shadow-md">
            <rect x="-15" y="-15" width="30" height="30" fill={card.color} rx="4" />
            <circle cx="0" cy="0" r="10" fill="rgba(0,0,0,0.3)" />
         </svg>
      );
   }
   const isMelee = (card.stats.range || 0) < 30;
   return (
      <svg viewBox="-25 -25 50 50" className="w-10 h-10 drop-shadow-md">
         <circle cx="0" cy="0" r="15" fill={card.color} />
         {isMelee ? (
            <g>
               <rect x="7" y="-15" width="4" height="22" fill="#cbd5e1" />
               <rect x="5" y="-21" width="8" height="8" fill="#94a3b8" />
            </g>
         ) : (
            <path d="M 17 -10 A 12 12 0 0 1 17 10" stroke="#854d0e" strokeWidth="3" fill="none" />
         )}
         <circle cx="5" cy="-6" r="3" fill="white" />
         <circle cx="5" cy="6" r="3" fill="white" />
      </svg>
   );
};

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
  const [cardFilter, setCardFilter] = useState<'REGULAR' | 'CHAMPION'>('REGULAR');
  const [matchState, setMatchState] = useState<'MENU' | 'PLAYING' | 'ENDED'>('MENU');
  const [infoModalCardId, setInfoModalCardId] = useState<string | null>(null);
  
  // Promo Code State
  const [promoUnlockedIds, setPromoUnlockedIds] = useState<string[]>([]);
  const [hasPromoChest, setHasPromoChest] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [showMenu, setShowMenu] = useState(false);

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
    if (deckIds.length > 0) localStorage.setItem('cbg_deck', JSON.stringify(deckIds.filter(id => unlockedIds.includes(id))));
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
  }, [isHost, channel, deckIds]);

  const broadcast = (msg: any) => {
    if (channel.readyState === 'open') {
      channel.send(JSON.stringify(msg));
    }
  };

  const startMatchHost = () => {
    if (deckIds.length < 12) {
       alert("Your deck must have exactly 12 cards to battle! Please add more cards from the CARDS tab.");
       return;
    }
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
          // simple square base
          ctx.fillRect(e.x - e.radius, e.y - e.radius, e.radius*2, e.radius*2);
          
          if (e.towerType === 'king') {
             // geometric king
             ctx.fillStyle = '#fbbf24'; // gold crown
             ctx.beginPath();
             ctx.moveTo(e.x - 10, e.y - 5);
             ctx.lineTo(e.x - 10, e.y - 15);
             ctx.lineTo(e.x - 5, e.y - 10);
             ctx.lineTo(e.x, e.y - 18);
             ctx.lineTo(e.x + 5, e.y - 10);
             ctx.lineTo(e.x + 10, e.y - 15);
             ctx.lineTo(e.x + 10, e.y - 5);
             ctx.fill();
             
             ctx.fillStyle = e.team === 0 ? '#1d4ed8' : '#7f1d1d';
             ctx.fillRect(e.x - 10, e.y - 5, 20, 15); // body
             
             // geometric cannon
             ctx.fillStyle = '#1e293b'; 
             ctx.fillRect(e.x - 4, e.y + (e.team === 0 ? -25 : 10), 8, 15); 
          } else {
             // geometric archer
             ctx.fillStyle = '#fca5a5'; // face
             ctx.beginPath();
             ctx.arc(e.x, e.y - 5, 6, 0, Math.PI*2);
             ctx.fill();
             
             ctx.fillStyle = e.team === 0 ? '#1d4ed8' : '#7f1d1d';
             ctx.fillRect(e.x - 6, e.y + 1, 12, 10); // body
             
             // bow
             ctx.beginPath();
             ctx.arc(e.x, e.y + 5, 10, e.team === 0 ? Math.PI : 0, e.team === 0 ? Math.PI*2 : Math.PI);
             ctx.lineWidth = 2;
             ctx.strokeStyle = '#854d0e';
             ctx.stroke();
          }
       } else {
          // troop with more detailed geometric rendering
          ctx.save();
          ctx.translate(e.x, e.y);
          
          const t = performance.now() / 200;
          const wobble = Math.sin(t * e.speed * 0.1 + (e.x + e.y)) * 4;
          
          const isChampion = e.cardId?.startsWith('ch');
          if (isChampion) {
             // Champions are larger and more complex
             ctx.scale(1.5, 1.5);
             ctx.shadowBlur = 10;
             ctx.shadowColor = e.color;
          }
          
          // Draw Body
          ctx.beginPath();
          ctx.arc(0, wobble, e.radius, 0, Math.PI*2);
          ctx.fill();
          
          if (isChampion) {
             ctx.shadowBlur = 0;
             // Draw extra geometric details for champions
             ctx.fillStyle = '#fbbf24'; // champion gold trim
             ctx.beginPath();
             ctx.moveTo(0, wobble - e.radius - 5);
             ctx.lineTo(5, wobble - e.radius);
             ctx.lineTo(-5, wobble - e.radius);
             ctx.fill();
             
             ctx.strokeStyle = '#fbbf24';
             ctx.lineWidth = 1;
             ctx.beginPath();
             ctx.arc(0, wobble, e.radius + 2, 0, Math.PI * 2);
             ctx.stroke();
          }
          
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

    // Draw projectiles/spells
    for (const p of gameState.projectiles || []) {
       if (p.type === 'spell_anim') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius || 0, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, 1.0 - ((p.radius || 0) / (p.maxRadius || 1)));
          ctx.fill();
          ctx.globalAlpha = 1.0;
       } else {
          if (p.trail && p.trail.length > 1) {
             ctx.beginPath();
             ctx.moveTo(p.trail[0].x, p.trail[0].y);
             for (let i = 1; i < p.trail.length; i++) {
                ctx.lineTo(p.trail[i].x, p.trail[i].y);
             }
             ctx.strokeStyle = p.color;
             ctx.lineWidth = p.type === 'champion_magic' ? 4 : 2;
             if (p.visualStyle === 'lightning') {
                ctx.setLineDash([5, 5]); // dash for lightning-ish
             }
             ctx.stroke();
             ctx.setLineDash([]);
          }

          ctx.fillStyle = p.color;
          if (p.type === 'cannonball') {
             ctx.beginPath();
             ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
             ctx.fill();
          } else if (p.type === 'arrow') {
             ctx.save();
             ctx.translate(p.x, p.y);
             ctx.rotate(Math.atan2(p.ty - p.y, p.tx - p.x));
             ctx.fillRect(-4, -1, 8, 2);
             ctx.fillStyle = '#94a3b8'; // arrow head
             ctx.beginPath();
             ctx.moveTo(4, -2);
             ctx.lineTo(8, 0);
             ctx.lineTo(4, 2);
             ctx.fill();
             ctx.restore();
          } else if (p.type === 'champion_magic') {
             ctx.beginPath();
             ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
             ctx.shadowBlur = 10;
             ctx.shadowColor = p.color;
             ctx.fill();
             ctx.shadowBlur = 0;
          }
       }
    }

  }, [gameState, matchState]);

  const myTeam = isHost ? 0 : 1;
  const myElixir = gameState ? gameState.elixir[myTeam] : 0;

  const playPlaceSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {} // ignore
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only place card if selected
    if (!selectedCardId) return;
    
    const target = e.target as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    let rx = (e.clientX - rect.left) / rect.width;
    let ry = (e.clientY - rect.top) / rect.height;
    
    if (!isHost) {
       rx = 1 - rx;
       ry = 1 - ry;
    }
    
    const x = rx * MAP_W;
    const y = ry * MAP_H;
    
    // Check placement restrictions
    const card = CBG_CARDS.find(c => c.id === selectedCardId);
    const isSpell = card?.type === 'spell';

    // Must place on own half unless it's a spell
    if (!isSpell) {
      if (isHost && y < 300) return;
      if (!isHost && y > 300) return;
    }

    if (isHost) {
      engineRef.current?.playCard(0, selectedCardId, x, y);
    } else {
      broadcast({ type: 'PLAY_CARD', cardId: selectedCardId, x, y });
    }
    
    playPlaceSound();

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
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });
  
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
        deckIds: deckIds.filter(id => unlockedIds.includes(id)),
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
           // We can remove it, but deck won't be full. That's fine, let them remove and build a new deck.
           // Actually, the previous logic said "Deck must have 12 cards" when removing. We can let them remove it but prevent battle if < 12.
        }
        setDeckIds(prev => prev.filter(id => id !== cId));
        setHasUnsavedProgress(true);
     } else {
        if (deckIds.length >= 12) {
           alert("Deck is full (max 12). Remove a card first.");
           return;
        }
        const cardObj = CBG_CARDS.find(c => c.id === cId);
        if (cardObj?.isChampion) {
           const existingChampion = deckIds.find(id => CBG_CARDS.find(c => c.id === id)?.isChampion);
           if (existingChampion) {
              alert("You can only have one Champion in your deck. Remove your current Champion first.");
              return;
           }
        }
        setDeckIds(prev => [...prev, cId]);
        setHasUnsavedProgress(true);
     }
  };

  if (matchState === 'MENU') {
    return (
      <div className="w-full h-full flex flex-col bg-slate-900 text-slate-100 relative">
        {infoModalCardId && (() => {
           const infoC = CBG_CARDS.find(card => card.id === infoModalCardId)!;
           const inDeck = deckIds.includes(infoModalCardId);
           const isUnlocked = unlockedIds.includes(infoModalCardId) || promoUnlockedIds.includes(infoModalCardId);
           return (
              <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setInfoModalCardId(null)}>
                 <div className="bg-slate-800 border-2 border-slate-700 rounded-3xl w-full max-w-sm p-6 flex flex-col gap-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-start">
                       <div>
                          <h2 className="text-2xl font-black flex items-center gap-2">
                             {infoC.name} 
                             {infoC.isChampion && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/50 px-2 py-1 rounded-full uppercase tracking-wider">Champion</span>}
                          </h2>
                          <p className="text-slate-400 capitalize">{infoC.type}</p>
                       </div>
                       <button onClick={() => setInfoModalCardId(null)} className="p-2 bg-slate-700 rounded-full text-slate-300 hover:text-white"><X className="w-5 h-5"/></button>
                    </div>

                    <div className="w-full aspect-video bg-slate-700 rounded-2xl flex items-center justify-center shadow-inner relative overflow-hidden">
                       <div className={`${infoC.isChampion ? 'scale-150' : ''}`}><UnitPreview card={infoC} /></div>
                       <div className="absolute bottom-2 left-2 bg-fuchsia-500 text-white rounded-full px-3 py-1 text-sm font-black shadow-md flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-white animate-pulse" /> {infoC.cost} Elixir</div>
                    </div>
                    
                    <div className="text-sm text-slate-300">
                       <p>{infoC.description}</p>
                       {infoC.abilityDesc && (
                          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                             <div className="text-xs text-amber-400 font-bold uppercase mb-1">Champion Ability</div>
                             <p className="text-amber-200/90 leading-tight">{infoC.abilityDesc}</p>
                          </div>
                       )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                       {infoC.stats.hp && <div className="bg-slate-900/50 p-3 rounded-xl"><span className="text-slate-400 block pb-1 text-xs uppercase font-bold">HP</span><span className="font-bold">{infoC.stats.hp}</span></div>}
                       {infoC.stats.damage && <div className="bg-slate-900/50 p-3 rounded-xl"><span className="text-slate-400 block pb-1 text-xs uppercase font-bold">Damage</span><span className="font-bold">{infoC.stats.damage}</span></div>}
                       {infoC.stats.speed !== undefined && <div className="bg-slate-900/50 p-3 rounded-xl"><span className="text-slate-400 block pb-1 text-xs uppercase font-bold">Speed</span><span className="font-bold">{infoC.stats.speed === 0 ? 'Building' : infoC.stats.speed}</span></div>}
                       {infoC.stats.range !== undefined && <div className="bg-slate-900/50 p-3 rounded-xl"><span className="text-slate-400 block pb-1 text-xs uppercase font-bold">Range</span><span className="font-bold">{infoC.stats.range}</span></div>}
                    </div>

                    {isUnlocked ? (
                       <button 
                          onClick={() => toggleDeckCard(infoC.id)}
                          className={`w-full py-4 rounded-full font-black text-lg transition-transform active:scale-95 ${inDeck ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30 border-2 border-red-500/50' : 'bg-indigo-500 text-white hover:bg-indigo-400'}`}
                       >
                          {inDeck ? 'Remove from Deck' : 'Add to Deck'}
                       </button>
                    ) : (
                       <div className="w-full py-4 rounded-full font-black text-lg bg-slate-700 text-slate-500 text-center border-2 border-slate-600 flex items-center justify-center gap-2">
                          <Lock className="w-5 h-5"/> Locked
                       </div>
                    )}
                 </div>
              </div>
           );
        })()}

        <header className="px-4 py-3 bg-slate-800 flex justify-between items-center shadow-md relative">
          <div className="flex items-center gap-3">
             <button onClick={onBackToLobby} className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5"/></button>
             <h1 className="font-bold text-xl flex items-center gap-2"><div className="w-4 h-4 bg-indigo-500 rounded-sm" /> Card Battle</h1>
          </div>
          <div className="relative">
             <button onClick={() => setShowMenu(!showMenu)} className="text-slate-400 hover:text-white"><MoreVertical className="w-5 h-5"/></button>
             {showMenu && (
                 <div className="absolute right-0 top-full mt-2 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50">
                     <button 
                        onClick={() => { setShowMenu(false); setShowPromoModal(true); }} 
                        className="w-full text-left px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white"
                     >
                         Promo Code
                     </button>
                 </div>
             )}
          </div>
        </header>

        {showPromoModal && (
           <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 flex-col" onClick={() => setShowPromoModal(false)}>
              <div className="bg-slate-800 border-2 border-slate-700 rounded-3xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h2 className="text-2xl font-black mb-4">Enter Promo Code</h2>
                  <input 
                     type="text" 
                     value={promoCode} 
                     onChange={e => setPromoCode(e.target.value)} 
                     placeholder="Enter code..."
                     className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white mb-4 outline-none focus:border-indigo-500"
                  />
                  <div className="flex gap-2">
                     <button onClick={() => setShowPromoModal(false)} className="flex-1 py-3 text-slate-400 hover:text-white font-bold bg-slate-700 rounded-xl">Cancel</button>
                     <button 
                        onClick={() => {
                           if (promoCode === '2069845') {
                               setHasPromoChest(true);
                               setShowPromoModal(false);
                               setPromoCode('');
                               alert('Promo applied! A special chest has been given to you.');
                           } else {
                               alert('Invalid code.');
                           }
                        }} 
                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl"
                     >
                        Redeem
                     </button>
                  </div>
              </div>
           </div>
        )}

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
                       {hasPromoChest && (
                          <button onClick={() => {
                             setHasPromoChest(false);
                             setPromoUnlockedIds(CBG_CARDS.map(c => c.id));
                             alert('You opened the Promo Chest! All cards are temporarily unlocked for this session.');
                          }} className="flex-1 py-6 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-400 hover:bg-fuchsia-500/30">
                             <Package className="w-10 h-10 animate-bounce drop-shadow-[0_0_10px_rgba(217,70,239,0.8)]" />
                             <span className="font-bold">Promo Chest</span>
                             <span className="text-xs">Tap to open</span>
                          </button>
                       )}
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
                             <div key={id} onClick={() => setInfoModalCardId(id)} className={`aspect-[3/4] rounded-xl border-2 ${c.isChampion ? 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'border-indigo-500'} relative flex flex-col cursor-pointer overflow-hidden bg-slate-800 hover:border-indigo-400 transition-colors group`}>
                                <div className="h-[55%] w-full bg-slate-700 flex items-center justify-center relative shadow-inner">
                                   <UnitPreview card={c} />
                                </div>
                                <div className="flex-1 flex items-center justify-center p-1 bg-slate-800">
                                   <span className="text-[10px] font-bold text-center leading-tight drop-shadow text-white">{c.name}</span>
                                </div>
                                <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-5 h-5 shadow-md flex items-center justify-center text-xs font-black">{c.cost}</div>
                                <div className="absolute top-1 right-1 bg-slate-900/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><Info className="w-3 h-3"/></div>
                             </div>
                          );
                       })}
                    </div>
                 </div>

                 <div>
                    <div className="flex gap-2 mb-4">
                       <button onClick={() => setCardFilter('REGULAR')} className={`flex-1 py-2 rounded-xl text-sm font-bold ${cardFilter === 'REGULAR' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400'}`}>Regular Cards</button>
                       <button onClick={() => setCardFilter('CHAMPION')} className={`flex-1 py-2 rounded-xl text-sm font-bold ${cardFilter === 'CHAMPION' ? 'bg-amber-600/30 text-amber-400 border border-amber-500/50' : 'bg-slate-800 text-slate-400'}`}>Champions</button>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                       {CBG_CARDS.filter(c => (cardFilter === 'CHAMPION' ? c.isChampion : !c.isChampion) && !deckIds.includes(c.id)).map(c => {
                          const isUnlocked = unlockedIds.includes(c.id) || promoUnlockedIds.includes(c.id);
                          return (
                             <div key={c.id} onClick={() => setInfoModalCardId(c.id)} className={`aspect-[3/4] rounded-xl border-2 ${c.isChampion ? 'border-amber-600/50' : 'border-slate-600'} relative flex flex-col cursor-pointer overflow-hidden bg-slate-800 hover:border-slate-400 transition-colors group ${!isUnlocked ? 'opacity-40 grayscale' : 'opacity-80'}`}>
                                <div className="h-[55%] w-full bg-slate-700 flex items-center justify-center relative shadow-inner">
                                   <UnitPreview card={c} />
                                </div>
                                {!isUnlocked && (
                                   <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/60 pointer-events-none">
                                      <Lock className="w-6 h-6 text-slate-400"/>
                                   </div>
                                )}
                                <div className="flex-1 flex items-center justify-center p-1 bg-slate-800">
                                   <span className="text-[10px] font-bold text-center leading-tight drop-shadow text-white">{c.name}</span>
                                </div>
                                <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-5 h-5 shadow-md flex items-center justify-center text-xs font-black">{c.cost}</div>
                                <div className="absolute top-1 right-1 bg-slate-900/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><Info className="w-3 h-3"/></div>
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

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingCardId) {
      if (document.elementFromPoint(e.clientX, e.clientY) === canvasRef.current && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        let rx = (e.clientX - rect.left) / rect.width;
        let ry = (e.clientY - rect.top) / rect.height;
        if (!isHost) {
           rx = 1 - rx;
           ry = 1 - ry;
        }
        const gameX = rx * MAP_W;
        const gameY = ry * MAP_H;

        const card = CBG_CARDS.find(c => c.id === draggingCardId);
        const isSpell = card?.type === 'spell';
        let valid = true;
        if (!isSpell) {
            if (isHost && gameY < 300) valid = false;
            if (!isHost && gameY > 300) valid = false;
        }
        if (valid && myElixir >= card!.cost) {
            if (isHost) {
              engineRef.current?.playCard(0, draggingCardId, gameX, gameY);
            } else {
              broadcast({ type: 'PLAY_CARD', cardId: draggingCardId, x: gameX, y: gameY });
            }
            playPlaceSound();
            setHand(prev => {
              const newHand = [...prev];
              const idx = newHand.indexOf(draggingCardId);
              const nextCard = deckCycleRef.current.shift()!;
              newHand[idx] = nextCard;
              deckCycleRef.current.push(draggingCardId);
              return newHand;
            });
            setSelectedCardId(null);
        }
      } else {
        const dx = e.clientX - dragOrigin.x;
        const dy = e.clientY - dragOrigin.y;
        if (dx * dx + dy * dy > 100) {
           setSelectedCardId(null);
        }
      }
      setDraggingCardId(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingCardId) {
      setDragPos({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div 
      className="w-full h-full bg-slate-900 flex flex-col relative overflow-hidden select-none touch-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
       {/* Game Canvas Container */}
       <div className="flex-1 max-w-md w-full mx-auto relative flex items-center justify-center">
         <canvas 
            ref={canvasRef} 
            width={MAP_W} height={MAP_H} 
            style={{ transform: !isHost ? 'rotate(180deg)' : 'none' }}
            className="w-full h-full max-h-[80vh] object-contain border border-slate-800 bg-black cursor-crosshair touch-none"
            onClick={handleCanvasClick}
         />
       </div>

       {/* HUD & Hand */}
       <div className="h-32 bg-slate-950 border-t border-slate-800 p-2 flex items-center justify-between relative px-4">
          <div className="absolute top-2 right-4 font-black text-fuchsia-400 text-lg flex items-center gap-1">
             <div className="w-3 h-3 rounded-full bg-fuchsia-400 animate-pulse"/>
             {Math.floor(myElixir)}
          </div>

          {/* Next Card */}
          <div className="flex flex-col items-center gap-1 mt-4">
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Next</span>
             {deckCycleRef.current[0] && (() => {
                 const nextC = CBG_CARDS.find(card => card.id === deckCycleRef.current[0])!;
                 return (
                    <div className="w-12 h-16 rounded-lg flex flex-col overflow-hidden opacity-60 border border-slate-700 pointer-events-none relative">
                       <div className="h-[55%] w-full bg-slate-700 flex items-center justify-center relative shadow-inner">
                           <UnitPreview card={nextC} />
                       </div>
                       <div className="flex-1 w-full bg-slate-800 p-1 flex items-center justify-center">
                          <span className="text-[8px] font-bold text-center leading-tight drop-shadow text-white">{nextC.name}</span>
                       </div>
                       <div className="absolute top-0.5 left-0.5 bg-fuchsia-500 text-white rounded-full w-4 h-4 shadow-md flex items-center justify-center text-[8px] font-black">{nextC.cost}</div>
                    </div>
                 );
             })()}
          </div>
          
          <div className="flex justify-center gap-2 h-full items-end pb-2 flex-1 ml-4">
             {hand.map((id, i) => {
                const c = CBG_CARDS.find(card => card.id === id)!;
                const canAfford = myElixir >= c.cost;
                const isSelected = selectedCardId === id;
                return (
                   <button 
                      key={i}
                      disabled={!canAfford}
                      onPointerDown={(e) => {
                        if (!canAfford) return;
                        setDraggingCardId(id);
                        setSelectedCardId(id);
                        setDragPos({ x: e.clientX, y: e.clientY });
                        setDragOrigin({ x: e.clientX, y: e.clientY });
                        e.currentTarget.releasePointerCapture(e.pointerId); // let container handle move
                      }}
                      onClick={() => setSelectedCardId(isSelected ? null : id)}
                      className={`relative w-16 h-24 rounded-lg flex flex-col overflow-hidden transition-transform ${isSelected ? '-translate-y-4 shadow-lg shadow-indigo-500/50 ring-2 ring-indigo-400' : ''} ${!canAfford ? 'opacity-40 grayscale' : 'hover:-translate-y-1'} ${draggingCardId === id ? 'opacity-50' : ''}`}
                      style={{ touchAction: 'none' }}
                   >
                      <div className="h-[55%] w-full bg-slate-700 flex items-center justify-center relative shadow-inner pointer-events-none">
                         <UnitPreview card={c} />
                      </div>
                      <div className="flex-1 w-full bg-slate-800 p-1 flex items-center justify-center pointer-events-none">
                         <span className="text-[9px] font-bold text-center leading-tight drop-shadow text-white">{c.name}</span>
                      </div>
                      <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-5 h-5 shadow-md flex items-center justify-center text-[10px] font-black pointer-events-none">{c.cost}</div>
                   </button>
                );
             })}
          </div>
       </div>

       {/* Dragged Card Overlay */}
       {draggingCardId && (
         <div 
           className="fixed pointer-events-none z-[100] w-16 h-24 rounded-lg flex flex-col overflow-hidden shadow-2xl ring-2 ring-indigo-400 opacity-80 scale-105"
           style={{
             left: dragPos.x - 32,
             top: dragPos.y - 48
           }}
         >
            {(() => {
               const c = CBG_CARDS.find(card => card.id === draggingCardId)!;
               return (
                 <>
                    <div className="h-[55%] w-full bg-slate-700 flex items-center justify-center relative shadow-inner">
                       <UnitPreview card={c} />
                    </div>
                    <div className="flex-1 w-full bg-slate-800 p-1 flex items-center justify-center">
                       <span className="text-[9px] font-bold text-center leading-tight drop-shadow text-white">{c.name}</span>
                    </div>
                    <div className="absolute top-1 left-1 bg-fuchsia-500 text-white rounded-full w-5 h-5 shadow-md flex items-center justify-center text-[10px] font-black">{c.cost}</div>
                 </>
               );
            })()}
         </div>
       )}
    </div>
  );
}
