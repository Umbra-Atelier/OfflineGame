import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { QRScanner } from './components/QRScanner';
import { decodeDescription, getCompleteLocalDescription, rtcConfig } from './lib/webrtc';
import { Smartphone, WifiOff, ScanLine, QrCode, BookOpen, Plus, ChevronRight, User, Volume2, VolumeX, Globe } from 'lucide-react';
import { GameType, BaseMessage } from './types';
import { setupAudio, setMuted, triggerHapticClick, playMusic } from './lib/audioManager';

// Components
import { Tutorial } from './components/Tutorial';
import { Lobby } from './components/Lobby';
import { TapWar } from './components/games/TapWar';
import { Pong } from './components/games/Pong';
import { ChessGame } from './components/games/ChessGame';
import { HiddenRole } from './components/games/HiddenRole';
import { Tournament } from './components/Tournament';
import { CardBattleGround } from './components/games/cbg/CardBattleGround';

type AppState =
  | 'IDLE'
  | 'TUTORIAL'
  | 'HOST_CHOOSE_NAME'
  | 'HOSTING_OFFER'
  | 'HOSTING_SCAN_ANSWER'
  | 'HOSTING_GUEST_CONNECTED'
  | 'JOIN_CHOOSE_NAME'
  | 'JOIN_SCAN_OFFER'
  | 'JOIN_ANSWER'
  | 'LOBBY'
  | 'PLAYING';

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [localData, setLocalData] = useState<string>(''); // Base64 compressed SDP
  const [errorTimer, setErrorTimer] = useState<string | null>(null);

  // Identity
  const [playerName, setPlayerName] = useState<string>('');
  const [activeGuestId, setActiveGuestId] = useState<string | null>(null);
  const [connectedGuests, setConnectedGuests] = useState<{id: string, name: string}[]>([]);
  const [myGuestId, setMyGuestId] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);

  // Audio State
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Global onClick to bind haptic feedback and Tone JS start
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (!hasInteracted) setHasInteracted(true);
      const target = e.target as HTMLElement;
      if (target.closest('button')) {
        triggerHapticClick();
      }
    };
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [hasInteracted]);

  // Game state
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null);

  // Sync music to game state
  useEffect(() => {
    if (audioEnabled && hasInteracted) {
       setupAudio().then(() => {
          setMuted(false);
          if (appState === 'PLAYING' && selectedGame) {
             playMusic(selectedGame);
          } else {
             playMusic('LOBBY');
          }
       });
    } else {
       setMuted(true);
    }
  }, [audioEnabled, appState, selectedGame, hasInteracted]);

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelsRef = useRef<Map<string, RTCDataChannel>>(new Map());

  const [isHostRole, setIsHostRole] = useState(false);

  // Broadcast to all channels
  const broadcast = (msg: any) => {
    channelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(msg));
      }
    });
  };

  // Handle global lobby messages
  useEffect(() => {
    if ((appState === 'LOBBY' || appState === 'PLAYING' || appState === 'JOIN_ANSWER')) {
      const handleGlobalMessage = (event: MessageEvent) => {
        try {
          const msg: BaseMessage = JSON.parse(event.data);
          
          if (msg.type === 'LOBBY_STATE' && !isHostRole) {
            setSelectedGame(msg.payload.game);
            setAppState('LOBBY');
          } else if (msg.type === 'SET_ID' && !isHostRole) {
            setMyGuestId(msg.payload.id);
            setConnectedGuests(msg.payload.guests);
            setHostName(msg.payload.hostName);
            setAppState('LOBBY');
          } else if (msg.type === 'START_GAME') {
            setAppState('PLAYING');
          } else if (msg.type === 'BACK_TO_LOBBY') {
            setAppState('LOBBY');
          } else if (msg.type === 'GO_TO_LOBBY') {
            setAppState('LOBBY');
          }
        } catch (e) {
          console.error("Failed to parse message", e);
        }
      };

      channelsRef.current.forEach(channel => {
        channel.addEventListener('message', handleGlobalMessage);
      });
      return () => {
        channelsRef.current.forEach(channel => {
          channel.removeEventListener('message', handleGlobalMessage);
        });
      };
    }
  }, [appState, isHostRole]);

  // Host sync lobby selection
  useEffect(() => {
    if (appState === 'LOBBY' && isHostRole) {
      broadcast({ type: 'LOBBY_STATE', payload: { game: selectedGame } });
    }
  }, [selectedGame, appState, isHostRole]);

  const startHostingFlow = () => {
    setIsHostRole(true);
    setAppState('HOST_CHOOSE_NAME');
  };

  const createHostOffer = async () => {
    try {
      const guestId = `guest-${Date.now()}`;
      setActiveGuestId(guestId);
      
      const peer = new RTCPeerConnection(rtcConfig);
      peersRef.current.set(guestId, peer);

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelsRef.current.set(guestId, channel);

      channel.onopen = () => {
        setAppState('HOSTING_GUEST_CONNECTED');
      };
      
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const compressedOffer = await getCompleteLocalDescription(peer, { hostName: playerName });
      setLocalData(compressedOffer);
      setAppState('HOSTING_OFFER');
    } catch (e: any) {
      setErrorTimer(e.message);
    }
  };

  const hostScanAnswer = async (decodedSdp: string) => {
    try {
      if (!activeGuestId) return;
      const peer = peersRef.current.get(activeGuestId);
      if (!peer) return;
      
      const desc = decodeDescription(decodedSdp);
      const guestName = desc.meta?.guestName || `Guest ${connectedGuests.length + 1}`;
      
      await peer.setRemoteDescription(desc);
      setConnectedGuests(prev => [...prev, { id: activeGuestId, name: guestName }]);
      // State transition will happen in channel.onopen
    } catch (e: any) {
      console.warn("Invalid answer code", e);
    }
  };

  const startJoinFlow = () => {
    setIsHostRole(false);
    setAppState('JOIN_CHOOSE_NAME');
  };

  const joinScanOffer = async (decodedSdp: string) => {
    try {
      const peer = new RTCPeerConnection(rtcConfig);
      const myId = 'host';
      peersRef.current.set(myId, peer);

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelsRef.current.set(myId, channel);
      
      channel.onopen = () => {
        // Wait for host to send GO_TO_LOBBY or just wait
      };

      const desc = decodeDescription(decodedSdp);
      // could extrace hostName from desc.meta.hostName if needed
      await peer.setRemoteDescription(desc);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      const compressedAnswer = await getCompleteLocalDescription(peer, { guestName: playerName });
      setLocalData(compressedAnswer);
      setAppState('JOIN_ANSWER');
    } catch (e: any) {
      console.warn("Invalid offer code", e);
    }
  };

  const handleStartMatch = () => {
    if (isHostRole) {
      broadcast({ type: 'START_GAME' });
      setAppState('PLAYING');
    }
  };

  const handleBackToLobby = () => {
    if (isHostRole) {
      broadcast({ type: 'BACK_TO_LOBBY' });
      setAppState('LOBBY');
    }
  };

  const clearConnections = () => {
    peersRef.current.forEach(p => p.close());
    peersRef.current.clear();
    channelsRef.current.clear();
    setConnectedGuests([]);
    setActiveGuestId(null);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans flex flex-col items-center overflow-x-hidden selection:bg-indigo-100">
      <header className="w-full max-w-lg mx-auto p-5 flex justify-between items-center bg-white/80 backdrop-blur-md shadow-[0_1px_3px_rgb(0_0_0_/_0.05)] sticky top-0 z-50">
        <h1 className="text-xl font-display font-bold flex items-center gap-2 tracking-tight text-neutral-900">
          <div className="bg-indigo-600 p-1.5 rounded-lg shadow-sm">
            <WifiOff className="w-4 h-4 text-white" />
          </div>
          OfflineArcade
        </h1>
        {appState !== 'IDLE' && appState !== 'TUTORIAL' && appState !== 'PLAYING' && appState !== 'LOBBY' && (
          <button
            onClick={() => {
              clearConnections();
              setAppState('IDLE');
            }}
            className="text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-md hover:bg-neutral-100 transition-colors"
          >
            Cancel
          </button>
        )}
        {(appState === 'LOBBY') && (
           <button
           onClick={() => {
             clearConnections();
             setAppState('IDLE');
             setSelectedGame(null);
           }}
           className="text-sm font-medium text-red-600 hover:text-red-700 px-3 py-1.5 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
         >
           Disconnect
         </button>
        )}
      </header>

      <main className="w-full max-w-lg mx-auto flex-1 flex flex-col items-center justify-center p-6 sm:p-8 relative">
        <button
          onClick={() => setAudioEnabled(!audioEnabled)}
          className="fixed bottom-6 right-6 z-50 p-4 bg-white/90 backdrop-blur border border-neutral-200/60 rounded-full shadow-lg shadow-neutral-900/10 text-neutral-600 hover:text-indigo-600 active:scale-95 transition-all outline-none"
          title="Toggle Audio/Haptics"
        >
          {audioEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
        </button>

        {errorTimer && (
          <div className="bg-red-100 text-red-800 p-3 rounded-lg text-sm mb-4 w-full shadow-sm">
            {errorTimer}
          </div>
        )}

        {appState === 'IDLE' && (
          <div className="space-y-6 w-full text-center">
            <div className="pb-8 pt-4">
              <div className="bg-indigo-600/10 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
                <Smartphone className="w-12 h-12 text-indigo-600 transform -rotate-3" />
              </div>
              <h2 className="text-4xl font-display font-extrabold mb-4 tracking-tight text-neutral-900">Local Multiplayer</h2>
              <p className="text-neutral-500 text-lg font-medium leading-relaxed">Connect to a friend's hotspot and play anywhere, without internet.</p>
            </div>

            <button
              onClick={() => setAppState('TUTORIAL')}
              className="w-full py-4 bg-indigo-50 text-indigo-700 rounded-2xl font-bold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 border border-indigo-200/60 active:scale-[0.98]"
            >
              <BookOpen className="w-5 h-5"/> Read Offline Setup Guide
            </button>

            <div className="pt-8 space-y-4">
              <div className="flex items-center gap-4 py-2 opacity-60">
                <div className="h-px bg-neutral-300 flex-1"></div>
                <span className="text-xs text-neutral-500 font-bold uppercase tracking-[0.2em]">Play Now</span>
                <div className="h-px bg-neutral-300 flex-1"></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={startHostingFlow}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl shadow-lg shadow-neutral-900/20 font-bold text-lg hover:bg-neutral-800 active:scale-[0.98] transition-all"
                >
                  Host Game
                </button>
                <button
                  onClick={startJoinFlow}
                  className="w-full py-5 bg-white text-neutral-900 border-2 border-neutral-200/80 rounded-2xl shadow-sm font-bold text-lg hover:border-neutral-300 hover:bg-neutral-50 active:scale-[0.98] transition-all"
                >
                  Join Game
                </button>
              </div>
            </div>
          </div>
        )}

        {appState === 'TUTORIAL' && (
          <Tutorial onComplete={() => setAppState('IDLE')} />
        )}

        {appState === 'HOST_CHOOSE_NAME' && (
          <div className="space-y-6 text-center w-full animate-in fade-in zoom-in-95 duration-300">
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">What's your name?</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Choose a name so players know who is hosting.</p>
            </div>
            <input 
              type="text" 
              autoFocus
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full p-4 text-lg border-2 border-neutral-200 rounded-2xl bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all font-medium text-center outline-none"
            />
            
            <div className="space-y-3 mt-4">
               <button
                 onClick={createHostOffer}
                 disabled={!playerName.trim()}
                 className="w-full py-4 bg-indigo-600 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-indigo-600/20 font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50"
               >
                 <QrCode className="w-5 h-5"/>
                 Host via QR Scan
               </button>
            </div>
          </div>
        )}

        {appState === 'JOIN_CHOOSE_NAME' && (
          <div className="space-y-6 text-center w-full animate-in fade-in zoom-in-95 duration-300">
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">What's your name?</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Choose a name before joining the host.</p>
            </div>
            <input 
              type="text" 
              autoFocus
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full p-4 text-lg border-2 border-neutral-200 rounded-2xl bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all font-medium text-center outline-none"
            />
            
            <div className="space-y-3 mt-4">
               <button
                 onClick={() => setAppState('JOIN_SCAN_OFFER')}
                 disabled={!playerName.trim()}
                 className="w-full py-4 bg-indigo-600 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-indigo-600/20 font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50"
               >
                 <QrCode className="w-5 h-5"/>
                 Scan Host QR
               </button>
            </div>
          </div>
        )}

        {appState === 'HOSTING_OFFER' && (
          <div className="space-y-6 text-center w-full animate-in fade-in zoom-in-95 duration-300">
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Host: Step 1</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Have your friend click "Scan Host QR", then scan this QR code.</p>
            </div>
            <div className="bg-white p-5 rounded-[2rem] shadow-sm inline-block mx-auto border border-neutral-200/60">
              <QRCodeSVG value={localData} size={250} level="L" marginSize={2} />
            </div>
            
            <button
              onClick={() => setAppState('HOSTING_SCAN_ANSWER')}
              className="w-full mt-8 py-4 bg-indigo-600 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-indigo-600/20 font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all"
            >
              <ScanLine className="w-5 h-5" />
              I scanned it, now scan theirs
            </button>
          </div>
        )}

        {appState === 'HOSTING_SCAN_ANSWER' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in slide-in-from-right duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Host: Step 2</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Scan the answer code on your friend's screen to connect.</p>
            </div>
            <QRScanner onScan={hostScanAnswer} />
          </div>
        )}

        {appState === 'HOSTING_GUEST_CONNECTED' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Lobby</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Players joined to {playerName || 'Host'}</p>
            </div>

            <div className="w-full bg-white rounded-3xl shadow-sm border border-neutral-200 p-4 space-y-3 mb-6">
               <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <User className="w-6 h-6 text-indigo-600" />
                  <span className="font-bold text-indigo-900 text-lg">{playerName || 'Host'} (You)</span>
               </div>
               {connectedGuests.map((guest, i) => (
                 <div key={guest.id} className="flex items-center gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-100 animate-in slide-in-from-right">
                    <User className="w-6 h-6 text-neutral-500" />
                    <span className="font-bold text-neutral-800 text-lg">{guest.name}</span>
                 </div>
               ))}
            </div>

            <div className="flex gap-4 w-full">
              <button
                onClick={() => setAppState('HOST_CHOOSE_NAME')}
                className="flex-1 py-4 bg-white text-indigo-600 border-2 border-indigo-100 flex justify-center items-center gap-2 rounded-2xl shadow-sm font-bold text-lg hover:bg-indigo-50 active:scale-[0.98] transition-all"
              >
                <Plus className="w-5 h-5" /> Add More
              </button>
              <button
                onClick={() => {
                  channelsRef.current.forEach((channel, guestId) => {
                     channel.send(JSON.stringify({ type: 'SET_ID', payload: { id: guestId, guests: connectedGuests, hostName: playerName } }));
                  });
                  setAppState('LOBBY');
                }}
                className="flex-[2] py-4 bg-indigo-600 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-indigo-600/20 font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all"
              >
                Next <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {appState === 'JOIN_SCAN_OFFER' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Join: Step 1</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Scan the host's QR code.</p>
            </div>
            <QRScanner onScan={joinScanOffer} />
          </div>
        )}

        {appState === 'JOIN_ANSWER' && (
          <div className="space-y-6 text-center w-full animate-in fade-in slide-in-from-right duration-300">
            {localData ? (
               <>
                 <div>
                   <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Join: Step 2</h2>
                   <p className="text-lg text-neutral-500 font-medium mb-8">Show this code to the host so they can scan it.</p>
                 </div>
                 
                 <div className="bg-white p-5 rounded-[2rem] shadow-sm inline-block mx-auto border border-neutral-200/60">
                   <QRCodeSVG value={localData} size={250} level="L" marginSize={2} />
                 </div>
               </>
            ) : (
               <div>
                  <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Waiting for Host</h2>
                  <p className="text-lg text-neutral-500 font-medium mb-8">Connected! Wait for the host to start the lobby.</p>
               </div>
            )}
            
            <p className="text-base tracking-wide text-indigo-600 mt-8 flex items-center justify-center gap-2 font-bold animate-pulse">
              <QrCode className="w-5 h-5" />
              Waiting for host...
            </p>
          </div>
        )}

        {appState === 'LOBBY' && (
          <Lobby 
            isHost={isHostRole} 
            selectedGame={selectedGame}
            onSelectGame={setSelectedGame}
            onStartGame={handleStartMatch}
          />
        )}

        {appState === 'PLAYING' && (
          <div className="w-full h-full flex items-center justify-center">
            {selectedGame === 'HIDDEN_ROLE' ? (
              <HiddenRole 
                channels={channelsRef.current} 
                isHost={isHostRole} 
                myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                myName={playerName}
                guests={connectedGuests}
                onBackToLobby={handleBackToLobby} 
              />
            ) : connectedGuests.length > 1 ? (
              <Tournament
                gameType={selectedGame!}
                myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                myName={playerName}
                players={[{id: 'host', name: isHostRole ? playerName : (hostName || 'Host')}, ...connectedGuests]}
                isGlobalHost={isHostRole}
                channelsRef={channelsRef}
                onBackToLobby={handleBackToLobby}
              />
            ) : (
              // Raw 2-player game (Host + 1 Guest)
              <>
                {selectedGame === 'TAP_WAR' && <TapWar channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} />}
                {selectedGame === 'PONG' && <Pong channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} />}
                {selectedGame === 'CHESS' && <ChessGame channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} />}
                {selectedGame === 'CARD_BATTLE' && <CardBattleGround channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} />}
              </>
            )}
          </div>
        )}
        
      </main>
    </div>
  );
}

