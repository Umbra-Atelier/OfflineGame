import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';
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
import { RocketLeague } from './components/games/RocketLeague';
import { MagicTiles } from './components/games/MagicTiles';
import { LaserTagArena } from './components/games/LaserTagArena';
import { NeonSnake } from './components/games/NeonSnake';
import { CoopHeist } from './components/games/coop-heist/CoopHeist';
import { ErrorBoundary } from './components/ErrorBoundary';

type AppState =
  | 'IDLE'
  | 'TUTORIAL'
  | 'HOST_CHOOSE_NAME'
  | 'HOSTING_OFFER'
  | 'HOSTING_SCAN_ANSWER'
  | 'HOSTING_CONNECTING'
  | 'HOSTING_GUEST_CONNECTED'
  | 'HOST_ONLINE_LOBBY'
  | 'JOIN_CHOOSE_NAME'
  | 'JOIN_SCAN_OFFER'
  | 'JOIN_ONLINE_LOBBY'
  | 'JOIN_CONNECTING'
  | 'JOIN_ANSWER'
  | 'JOIN_WAITING_FOR_HOST'
  | 'LOBBY'
  | 'PLAYING';

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [localData, setLocalData] = useState<string>(''); // Base64 compressed SDP
  const [errorTimer, setErrorTimer] = useState<string | null>(null);
  
  // MQTT for Online
  const mqttRef = useRef<MqttClient | null>(null);
  const myMqttIdRef = useRef<string | null>(null);
  const [availableHosts, setAvailableHosts] = useState<any[]>([]);
  const [onlineHostId, setOnlineHostId] = useState<string | null>(null);

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
      if (target?.closest && target.closest('button')) {
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
       setMuted(false);
       if (appState === 'PLAYING' && selectedGame) {
          playMusic(selectedGame);
       } else {
          playMusic('LOBBY');
       }
    } else {
       setMuted(true);
    }
  }, [audioEnabled, appState, selectedGame, hasInteracted]);

  const [channelsUpdated, setChannelsUpdated] = useState(0);
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
    if ((appState === 'LOBBY' || appState === 'PLAYING' || appState === 'JOIN_ANSWER' || appState === 'JOIN_CONNECTING' || appState === 'JOIN_WAITING_FOR_HOST')) {
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
  }, [appState, isHostRole, channelsUpdated]);

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

  const startJoinFlow = () => {
    setIsHostRole(false);
    setAppState('JOIN_CHOOSE_NAME');
  };

  const createHostOffer = async () => {
    try {
      const guestId = `guest-${Date.now()}`;
      setActiveGuestId(guestId);
      
      const peer = new RTCPeerConnection(rtcConfig);
      peersRef.current.set(guestId, peer);

      peer.oniceconnectionstatechange = () => {
         if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
             setErrorTimer("Connection lost. Please try again.");
             setAppState('HOSTING_SCAN_ANSWER');
         }
      };

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelsRef.current.set(guestId, channel);
      setChannelsUpdated(c => c + 1);

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
      if (!peer || peer.signalingState === 'stable') {
        // Already processed
        return;
      }
      
      const desc = decodeDescription(decodedSdp);
      const guestName = desc.meta?.guestName || `Guest ${connectedGuests.length + 1}`;
      
      triggerHapticClick();
      await peer.setRemoteDescription(desc);
      setConnectedGuests(prev => [...prev, { id: activeGuestId, name: guestName }]);
      setAppState('HOSTING_CONNECTING');
      
      // Handle potential connection timeouts
      const timeoutId = setTimeout(() => {
         if (channel && channel.readyState !== 'open') {
             setErrorTimer("Connection timed out. Devices might not be able to reach each other.");
             setAppState('HOSTING_SCAN_ANSWER');
         }
      }, 15000);

      const channel = channelsRef.current.get(activeGuestId);
      if (channel) {
         channel.onopen = () => {
           clearTimeout(timeoutId);
           setAppState('HOSTING_GUEST_CONNECTED');
         };
      }
      
    } catch (e: any) {
      console.warn("Invalid answer code", e);
    }
  };

  const startOnlineHost = () => {
    setIsHostRole(true);
    setAppState('HOST_ONLINE_LOBBY');
    
    if (mqttRef.current && myMqttIdRef.current && mqttRef.current.connected) {
        mqttRef.current.publish(`tt-arcade-v3/lobby/hosts/${myMqttIdRef.current}`, '', { retain: true, qos: 1 });
        mqttRef.current.end();
    }
    const myId = `host-${Math.random().toString(36).substring(2, 9)}`;
    myMqttIdRef.current = myId;

    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
      clientId: myId,
      will: {
        topic: `tt-arcade-v3/lobby/hosts/${myId}`,
        payload: '',
        retain: true,
        qos: 1
      }
    });
    mqttRef.current = client;

    client.on('connect', () => {
       client.publish(`tt-arcade-v3/lobby/hosts/${myId}`, JSON.stringify({ name: playerName }), { retain: true, qos: 1 });
       client.subscribe(`tt-arcade-v3/lobby/p/${myId}`);
    });

    client.on('message', async (topic, message) => {
       if (topic === `tt-arcade-v3/lobby/p/${myId}`) {
          const data = JSON.parse(message.toString());
          if (data.type === 'host_request') {
             const guestMqttId = data.sourceId;
             
             // Accept the request
             client.publish(`tt-arcade-v3/lobby/p/${guestMqttId}`, JSON.stringify({ type: 'client_accept_request' }));
             
             const guestId = `guest-${guestMqttId}`;
             setActiveGuestId(guestId);
             
             const peer = new RTCPeerConnection(rtcConfig);
             peersRef.current.set(guestId, peer);

             peer.oniceconnectionstatechange = () => {
                if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
                    setErrorTimer(`Connection lost with ${data.hostName}`);
                }
             };

             const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
             channelsRef.current.set(guestId, channel);
             setChannelsUpdated(c => c + 1);

             channel.onopen = () => {
               setConnectedGuests(prev => [...prev, { id: guestId, name: data.hostName }]);
               channel.send(JSON.stringify({ type: 'SET_ID', payload: { id: guestId, guests: connectedGuests, hostName: playerName } }));
             };
             
             const offer = await peer.createOffer();
             await peer.setLocalDescription(offer);

             const compressedOffer = await getCompleteLocalDescription(peer, { hostName: playerName });
             client.publish(`tt-arcade-v3/lobby/p/${guestMqttId}`, JSON.stringify({ type: 'receive_offer', sourceId: myId, sdp: compressedOffer }));
          } else if (data.type === 'receive_answer') {
             const guestId = `guest-${data.sourceId}`;
             const peer = peersRef.current.get(guestId);
             if (peer) {
                const desc = decodeDescription(data.sdp);
                await peer.setRemoteDescription(desc);
             }
          }
       }
    });
  };

  const startOnlineJoin = () => {
    setIsHostRole(false);
    setAppState('JOIN_ONLINE_LOBBY');

    if (mqttRef.current) mqttRef.current.end();
    const myId = `guest-${Math.random().toString(36).substring(2, 9)}`;
    myMqttIdRef.current = myId;

    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId: myId });
    mqttRef.current = client;

    client.on('connect', () => {
       client.subscribe(`tt-arcade-v3/lobby/hosts/+`);
       client.subscribe(`tt-arcade-v3/lobby/p/${myId}`);
       setAvailableHosts([]);
    });

    client.on('message', async (topic, message) => {
       if (topic.startsWith('tt-arcade-v3/lobby/hosts/')) {
          const hostId = topic.split('/').pop();
          if (message.length === 0) {
             setAvailableHosts(prev => prev.filter(h => h.id !== hostId));
          } else {
             try {
               const hostData = JSON.parse(message.toString());
               setAvailableHosts(prev => {
                  if (prev.find(h => h.id === hostId)) return prev;
                  return [...prev, { id: hostId, ...hostData }];
               });
             } catch (e) {}
          }
       } else if (topic === `tt-arcade-v3/lobby/p/${myId}`) {
          const data = JSON.parse(message.toString());
          if (data.type === 'receive_offer') {
             const hostMqttId = data.sourceId;
             setAppState('JOIN_CONNECTING');
             
             const peerMyId = 'host';
             const peer = new RTCPeerConnection(rtcConfig);
             peersRef.current.set(peerMyId, peer);

             peer.oniceconnectionstatechange = () => {
                if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
                    setErrorTimer("Connection lost with host.");
                    setAppState('JOIN_ONLINE_LOBBY');
                }
             };

             const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
             channelsRef.current.set(peerMyId, channel);
             setChannelsUpdated(c => c + 1);
             
             channel.onopen = () => {
                 setAppState('JOIN_WAITING_FOR_HOST');
             };
             
             const desc = decodeDescription(data.sdp);
             await peer.setRemoteDescription(desc);

             const answer = await peer.createAnswer();
             await peer.setLocalDescription(answer);

             const compressedAnswer = await getCompleteLocalDescription(peer, { guestName: playerName });
             client.publish(`tt-arcade-v3/lobby/p/${hostMqttId}`, JSON.stringify({ type: 'receive_answer', sourceId: myId, sdp: compressedAnswer }));
          }
       }
    });
  };

  const joinOnlineHost = (hostId: string) => {
    setOnlineHostId(hostId);
    if (mqttRef.current && myMqttIdRef.current) {
        mqttRef.current.publish(`tt-arcade-v3/lobby/p/${hostId}`, JSON.stringify({ type: 'host_request', sourceId: myMqttIdRef.current, hostName: playerName }));
    }
    setAppState('JOIN_CONNECTING');
  };

  const joinScanOffer = async (decodedSdp: string) => {
    try {
      const myId = 'host';
      if (peersRef.current.has(myId) && peersRef.current.get(myId)?.signalingState !== 'stable') {
         return; // Already connecting
      }

      const peer = new RTCPeerConnection(rtcConfig);
      peersRef.current.set(myId, peer);

      peer.oniceconnectionstatechange = () => {
         if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
             setErrorTimer("Connection lost. Please try scanning again.");
             setAppState('JOIN_SCAN_OFFER');
         }
      };

      const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });
      channelsRef.current.set(myId, channel);
      setChannelsUpdated(c => c + 1);
      
      channel.onopen = () => {
        setAppState('JOIN_WAITING_FOR_HOST');
      };

      triggerHapticClick();
      setAppState('JOIN_CONNECTING');
      const desc = decodeDescription(decodedSdp);
      await peer.setRemoteDescription(desc);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      const compressedAnswer = await getCompleteLocalDescription(peer, { guestName: playerName });
      setLocalData(compressedAnswer);
      setAppState('JOIN_ANSWER');
      
      // Also add a fallback if we don't connect within 10 seconds?
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
    if (mqttRef.current) {
        if (myMqttIdRef.current && isHostRole && mqttRef.current.connected) {
             mqttRef.current.publish(`tt-arcade-v3/lobby/hosts/${myMqttIdRef.current}`, '', { retain: true, qos: 1 });
        }
        mqttRef.current.end();
        mqttRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans flex flex-col items-center overflow-x-hidden selection:bg-indigo-100">
      {(!hasInteracted) && (
        <div className="fixed inset-0 bg-neutral-900/90 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center text-white pointer-events-auto">
           <Volume2 className="w-16 h-16 mb-4 animate-bounce" />
           <h2 className="text-4xl font-black mb-2 tracking-tight">Enable Audio</h2>
           <p className="text-neutral-300 font-medium mb-8 text-center max-w-sm">This app requires audio. Click the button below to grant permission and continue.</p>
           <button onClick={() => setHasInteracted(true)} className="px-10 py-5 bg-indigo-600 border border-indigo-500 rounded-3xl font-black text-2xl hover:bg-indigo-700 shadow-[0_0_40px_rgba(79,70,229,0.3)] active:scale-95 transition-all text-white">
              Enter Arcade
           </button>
        </div>
      )}
      {!(appState === 'PLAYING' && (selectedGame === 'ROCKET_LEAGUE' || selectedGame === 'LASER_TAG' || selectedGame === 'NEON_SNAKE' || selectedGame === 'COOP_HEIST')) && (
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
      )}

      <main className={`w-full mx-auto flex-1 flex flex-col items-center justify-center relative ${appState === 'PLAYING' && (selectedGame === 'ROCKET_LEAGUE' || selectedGame === 'LASER_TAG' || selectedGame === 'NEON_SNAKE' || selectedGame === 'COOP_HEIST') ? '' : 'max-w-lg p-6 sm:p-8'}`}>
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
              <p className="text-neutral-500 text-lg font-medium leading-relaxed">Connect to a friend's hotspot and play anywhere, without internet. Add this app to your bookmarks and home screen to ensure your browser remembers it while offline.</p>
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
                 Host Offline (QR Scan)
               </button>
               <button
                 onClick={startOnlineHost}
                 disabled={!playerName.trim()}
                 className="w-full py-4 bg-neutral-900 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-neutral-900/20 font-bold text-lg hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50"
               >
                 <Globe className="w-5 h-5"/>
                 Host Online (Global)
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
                 Scan Offline QR
               </button>
               <button
                 onClick={startOnlineJoin}
                 disabled={!playerName.trim()}
                 className="w-full py-4 bg-neutral-900 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-neutral-900/20 font-bold text-lg hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50"
               >
                 <Globe className="w-5 h-5"/>
                 Find Online Hosts
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

        {appState === 'HOSTING_CONNECTING' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Connecting...</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Establishing peer-to-peer connection.</p>
            </div>
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
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
                     if (channel.readyState === 'open') {
                         channel.send(JSON.stringify({ type: 'SET_ID', payload: { id: guestId, guests: connectedGuests, hostName: playerName } }));
                     }
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

        {appState === 'HOST_ONLINE_LOBBY' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Online Lobby</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Waiting for players to join online...</p>
            </div>

            <div className="w-full bg-white rounded-3xl shadow-sm border border-neutral-200 p-4 space-y-3 mb-6">
               <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <User className="w-6 h-6 text-indigo-600" />
                  <span className="font-bold text-indigo-900 text-lg">{playerName || 'Host'} (You)</span>
               </div>
               {connectedGuests.map((guest) => (
                 <div key={guest.id} className="flex items-center gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-100 animate-in slide-in-from-right">
                    <User className="w-6 h-6 text-neutral-500" />
                    <span className="font-bold text-neutral-800 text-lg">{guest.name}</span>
                 </div>
               ))}
               <div className="p-4 text-neutral-400 font-medium flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-neutral-300 border-t-neutral-400 rounded-full animate-spin"></div>
                  {connectedGuests.length === 0 ? 'Searching for players...' : 'Listening for more players...'}
               </div>
            </div>

            <button
              onClick={() => {
                channelsRef.current.forEach((channel, guestId) => {
                   if (channel.readyState === 'open') {
                       channel.send(JSON.stringify({ type: 'SET_ID', payload: { id: guestId, guests: connectedGuests, hostName: playerName } }));
                   }
                });
                setAppState('LOBBY');
              }}
              disabled={connectedGuests.length === 0}
              className="w-full py-4 bg-indigo-600 text-white flex justify-center items-center gap-2 rounded-2xl shadow-lg shadow-indigo-600/20 font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Start Game <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {appState === 'JOIN_ONLINE_LOBBY' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Available Hosts</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Select a host to join.</p>
            </div>

            <div className="w-full space-y-3">
              {availableHosts.map((host) => (
                 <button 
                    key={host.id} 
                    onClick={() => joinOnlineHost(host.id)}
                    className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-neutral-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all group"
                 >
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                          <User className="w-5 h-5"/>
                       </div>
                       <span className="font-bold text-lg text-neutral-800">{host.name}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-neutral-400 group-hover:text-indigo-600 transition-colors" />
                 </button>
              ))}
              {availableHosts.length === 0 && (
                <div className="p-8 text-neutral-400 font-medium flex flex-col items-center justify-center gap-4 bg-white shadow-sm border border-neutral-200 rounded-3xl">
                   <div className="w-8 h-8 border-4 border-neutral-200 border-t-indigo-400 rounded-full animate-spin"></div>
                   Looking for public hosts...
                </div>
              )}
            </div>
            
            <button
               onClick={() => {
                   setAvailableHosts([]);
                   mqttRef.current?.unsubscribe('tt-arcade-v3/lobby/hosts/+');
                   setTimeout(() => {
                       mqttRef.current?.subscribe('tt-arcade-v3/lobby/hosts/+');
                   }, 100);
               }}
               className="mt-6 text-indigo-600 font-bold px-4 py-2 hover:bg-indigo-50 rounded-lg transition-colors"
            >
               Refresh List
            </button>
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

        {appState === 'JOIN_CONNECTING' && (
          <div className="space-y-6 text-center w-full flex flex-col items-center animate-in fade-in zoom-in duration-300">
             <div>
              <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Processing...</h2>
              <p className="text-lg text-neutral-500 font-medium mb-8">Generating your connection code.</p>
            </div>
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          </div>
        )}

        {(appState === 'JOIN_ANSWER' || appState === 'JOIN_WAITING_FOR_HOST') && (
          <div className="space-y-6 text-center w-full animate-in fade-in slide-in-from-right duration-300">
            {(appState === 'JOIN_ANSWER' && localData) ? (
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
          <div className="w-full flex-1 flex items-center justify-center min-h-0">
            {selectedGame === 'HIDDEN_ROLE' ? (
              <HiddenRole 
                channels={channelsRef.current} 
                isHost={isHostRole} 
                myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                myName={playerName}
                guests={connectedGuests}
                onBackToLobby={handleBackToLobby} 
              />
            ) : selectedGame === 'LASER_TAG' ? (
              <LaserTagArena
                channels={channelsRef.current}
                isHost={isHostRole}
                myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                myName={playerName}
                guests={connectedGuests}
                onBackToLobby={handleBackToLobby}
              />
            ) : selectedGame === 'NEON_SNAKE' ? (
              <ErrorBoundary>
                <NeonSnake
                  channels={channelsRef.current}
                  isHost={isHostRole}
                  myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                  myName={playerName}
                  guests={connectedGuests}
                  onBackToLobby={handleBackToLobby}
                />
              </ErrorBoundary>
            ) : selectedGame === 'COOP_HEIST' ? (
              <ErrorBoundary>
                <CoopHeist
                  channels={channelsRef.current}
                  isHost={isHostRole}
                  myId={isHostRole ? 'host' : (myGuestId || 'player-joiner')}
                  myName={playerName}
                  guests={connectedGuests}
                  onBackToLobby={handleBackToLobby}
                />
              </ErrorBoundary>
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
                {selectedGame === 'ROCKET_LEAGUE' && <ErrorBoundary><RocketLeague channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} /></ErrorBoundary>}
                {selectedGame === 'MAGIC_TILES' && <ErrorBoundary><MagicTiles channel={channelsRef.current.values().next().value} isHost={isHostRole} onBackToLobby={handleBackToLobby} /></ErrorBoundary>}
              </>
            )}
          </div>
        )}
        
      </main>
    </div>
  );
}

