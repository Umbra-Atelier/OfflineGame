import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { QRScanner } from './components/QRScanner';
import { decodeDescription, getCompleteLocalDescription, rtcConfig } from './lib/webrtc';
import { Smartphone, WifiOff, ScanLine, QrCode, BookOpen } from 'lucide-react';
import { GameType, BaseMessage } from './types';

// Components
import { Tutorial } from './components/Tutorial';
import { Lobby } from './components/Lobby';
import { TapWar } from './components/games/TapWar';
import { Pong } from './components/games/Pong';
import { ChessGame } from './components/games/ChessGame';
import { HiddenRole } from './components/games/HiddenRole';

type AppState =
  | 'IDLE'
  | 'TUTORIAL'
  | 'HOSTING_OFFER'
  | 'HOSTING_SCAN_ANSWER'
  | 'JOIN_SCAN_OFFER'
  | 'JOIN_ANSWER'
  | 'LOBBY'
  | 'PLAYING';

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [localData, setLocalData] = useState<string>(''); // Base64 compressed SDP
  const [errorTimer, setErrorTimer] = useState<string | null>(null);

  // Game state
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);

  const isHost = peerRef.current?.localDescription?.type === 'offer';

  // Handle global lobby messages when in LOBBY state
  useEffect(() => {
    if ((appState === 'LOBBY' || appState === 'PLAYING') && channelRef.current) {
      const handleGlobalMessage = (event: MessageEvent) => {
        try {
          const msg: BaseMessage = JSON.parse(event.data);
          
          if (msg.type === 'LOBBY_STATE' && !isHost) {
            setSelectedGame(msg.payload.game);
          } else if (msg.type === 'START_GAME') {
            setAppState('PLAYING');
          } else if (msg.type === 'BACK_TO_LOBBY') {
            setAppState('LOBBY');
          }
        } catch (e) {
          console.error("Failed to parse message", e);
        }
      };

      const channel = channelRef.current;
      channel.addEventListener('message', handleGlobalMessage);
      return () => channel.removeEventListener('message', handleGlobalMessage);
    }
  }, [appState, isHost]);

  // Host sync lobby selection
  useEffect(() => {
    if (appState === 'LOBBY' && isHost && channelRef.current?.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'LOBBY_STATE', payload: { game: selectedGame } }));
    }
  }, [selectedGame, appState, isHost]);

  // Initialize Host
  const startHosting = async () => {
    try {
      const peer = new RTCPeerConnection(rtcConfig);
      peerRef.current = peer;

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelRef.current = channel;

      channel.onopen = () => setAppState('LOBBY');
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setAppState('LOBBY');
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const compressedOffer = await getCompleteLocalDescription(peer);
      setLocalData(compressedOffer);
      setAppState('HOSTING_OFFER');
    } catch (e: any) {
      setErrorTimer(e.message);
    }
  };

  const hostScanAnswer = async (decodedSdp: string) => {
    try {
      const peer = peerRef.current;
      if (!peer) return;
      const desc = decodeDescription(decodedSdp);
      await peer.setRemoteDescription(desc);
      setAppState('LOBBY');
    } catch (e: any) {
      console.warn("Invalid answer code", e);
    }
  };

  const startJoin = () => {
    setAppState('JOIN_SCAN_OFFER');
  };

  const joinScanOffer = async (decodedSdp: string) => {
    try {
      const peer = new RTCPeerConnection(rtcConfig);
      peerRef.current = peer;

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelRef.current = channel;
      channel.onopen = () => setAppState('LOBBY');
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setAppState('LOBBY');
      };

      const desc = decodeDescription(decodedSdp);
      await peer.setRemoteDescription(desc);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      const compressedAnswer = await getCompleteLocalDescription(peer);
      setLocalData(compressedAnswer);
      setAppState('JOIN_ANSWER');
    } catch (e: any) {
      console.warn("Invalid offer code", e);
    }
  };

  const handleStartMatch = () => {
    if (isHost && channelRef.current?.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'START_GAME' }));
      setAppState('PLAYING');
    }
  };

  const handleBackToLobby = () => {
    if (channelRef.current?.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'BACK_TO_LOBBY' }));
      setAppState('LOBBY');
    }
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
              peerRef.current?.close();
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
             peerRef.current?.close();
             setAppState('IDLE');
             setSelectedGame(null);
           }}
           className="text-sm font-medium text-red-600 hover:text-red-700 px-3 py-1.5 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
         >
           Disconnect
         </button>
        )}
      </header>

      <main className="w-full max-w-lg mx-auto flex-1 flex flex-col items-center justify-center p-6 sm:p-8">
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
                  onClick={startHosting}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl shadow-lg shadow-neutral-900/20 font-bold text-lg hover:bg-neutral-800 active:scale-[0.98] transition-all"
                >
                  Host Game
                </button>
                <button
                  onClick={startJoin}
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

        {appState === 'HOSTING_OFFER' && (
          <div className="space-y-6 text-center w-full animate-in fade-in zoom-in-95 duration-300">
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Host: Step 1</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Have your friend click "Join", then scan this QR code.</p>
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
            <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Join: Step 2</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Show this code to the host so they can scan it.</p>
            </div>
            
            <div className="bg-white p-5 rounded-[2rem] shadow-sm inline-block mx-auto border border-neutral-200/60">
              <QRCodeSVG value={localData} size={250} level="L" marginSize={2} />
            </div>
            
            <p className="text-base tracking-wide text-indigo-600 mt-8 flex items-center justify-center gap-2 font-bold animate-pulse">
              <QrCode className="w-5 h-5" />
              Waiting for host...
            </p>
          </div>
        )}

        {appState === 'LOBBY' && (
          <Lobby 
            isHost={isHost} 
            selectedGame={selectedGame}
            onSelectGame={setSelectedGame}
            onStartGame={handleStartMatch}
          />
        )}

        {appState === 'PLAYING' && selectedGame === 'TAP_WAR' && channelRef.current && (
           <TapWar channel={channelRef.current} isHost={isHost} onBackToLobby={handleBackToLobby} />
        )}
        {appState === 'PLAYING' && selectedGame === 'PONG' && channelRef.current && (
           <Pong channel={channelRef.current} isHost={isHost} onBackToLobby={handleBackToLobby} />
        )}
        {appState === 'PLAYING' && selectedGame === 'CHESS' && channelRef.current && (
           <ChessGame channel={channelRef.current} isHost={isHost} onBackToLobby={handleBackToLobby} />
        )}
        {appState === 'PLAYING' && selectedGame === 'HIDDEN_ROLE' && channelRef.current && (
           <HiddenRole channel={channelRef.current} isHost={isHost} onBackToLobby={handleBackToLobby} />
        )}
        
      </main>
    </div>
  );
}

