import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { rtcConfig, getCompleteLocalDescription, decodeDescription } from '../lib/webrtc';
import { User, ShieldCheck, Gamepad2, ArrowRight } from 'lucide-react';

interface LANConnectionManagerProps {
  playerName: string;
  isHostFlow: boolean;
  onConnectionEstablished: (peer: RTCPeerConnection, channel: RTCDataChannel, remoteHostName?: string) => void;
  onCancel: () => void;
}

export function LANConnectionManager({ playerName, isHostFlow, onConnectionEstablished, onCancel }: LANConnectionManagerProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [requestStatus, setRequestStatus] = useState<'IDLE' | 'HOST_WAITING' | 'CLIENT_REQUESTED' | 'CONNECTING'>('IDLE');
  
  // For the host acknowledging a connection request
  const [pendingJoiner, setPendingJoiner] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const s = io({ path: '/socket.io' });
    setSocket(s);

    if (isHostFlow) {
       s.emit("register_host", { name: playerName });
       setRequestStatus('HOST_WAITING');
    } else {
       s.emit("register_client", { name: playerName });
    }

    s.on("host_list_update", (list) => {
       setHosts(list);
    });

    s.on("client_list_update", (list) => {
       // A client joining would see hosts
       setHosts(list.filter((c: any) => c.isHost));
    });

    return () => {
      s.disconnect();
    };
  }, [playerName, isHostFlow]);

  useEffect(() => {
    if (!socket) return;

    if (isHostFlow) {
      socket.on("connection_requested", (data) => {
        setPendingJoiner({ id: data.joinerId, name: data.joinerName });
      });

      socket.on("connection_answer", async (data) => {
         const { joinerId, sdp } = data;
         // Pass back up. Wait, this needs to be integrated with WebRTC flow.
         // Actually, if we use WebRTC over sockets:
      });
    } else {
      socket.on("connection_accepted", async (data) => {
         const { hostId, sdp } = data;
         // Handle offer from host
      });
    }

    return () => {
      socket.off("connection_requested");
      socket.off("connection_accepted");
      socket.off("connection_answer");
    };
  }, [socket, isHostFlow]);

  // We will pass logic up, but the flow needs RTCPeerConnection creation here, 
  // because this component manages the socket signaling.

  const createHostOfferForJoiner = async (joinerId: string) => {
     if (!socket) return;
     try {
       setRequestStatus('CONNECTING');
       const peer = new RTCPeerConnection(rtcConfig);
       const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });

       peer.onicecandidate = (e) => {
          if (e.candidate) {
            socket.emit("ice_candidate", { targetId: joinerId, candidate: e.candidate });
          }
       };

       const offer = await peer.createOffer();
       await peer.setLocalDescription(offer);
       
       socket.emit("connection_accepted", { joinerId, sdp: peer.localDescription });

       // Listen for answer
       const onAnswer = async (data: any) => {
          if (data.joinerId === joinerId) {
             await peer.setRemoteDescription(data.sdp);
             socket.off("connection_answer", onAnswer);
          }
       };
       socket.on("connection_answer", onAnswer);

       const onIce = (data: any) => {
          if (data.senderId === joinerId && data.candidate) {
             peer.addIceCandidate(data.candidate);
          }
       };
       socket.on("ice_candidate", onIce);

       channel.onopen = () => {
          onConnectionEstablished(peer, channel);
       };

     } catch (err) {
       console.error(err);
       setRequestStatus('HOST_WAITING');
       setPendingJoiner(null);
     }
  };

  const handleJoinHost = async (hostId: string) => {
     if (!socket) return;
     setRequestStatus('CLIENT_REQUESTED');
     socket.emit("request_connection", { hostId, joinerName: playerName });

     // Wait for offer
     const onAccepted = async (data: any) => {
        if (data.hostId === hostId) {
            try {
               const peer = new RTCPeerConnection(rtcConfig);
               const channel = peer.createDataChannel('game', { negotiated: true, id: 0 });

               peer.onicecandidate = (e) => {
                  if (e.candidate) {
                     socket.emit("ice_candidate", { targetId: hostId, candidate: e.candidate });
                  }
               };
               
               await peer.setRemoteDescription(data.sdp);
               const answer = await peer.createAnswer();
               await peer.setLocalDescription(answer);

               socket.emit("connection_answer", { hostId, sdp: peer.localDescription });

               const onIce = (data: any) => {
                  if (data.senderId === hostId && data.candidate) {
                     peer.addIceCandidate(data.candidate);
                  }
               };
               socket.on("ice_candidate", onIce);

               channel.onopen = () => {
                 // Determine remoteHostName from list? 
                 const hName = hosts.find(h => h.id === hostId)?.name || 'Host';
                 onConnectionEstablished(peer, channel, hName);
               };

               socket.off("connection_accepted", onAccepted);
            } catch (err) {
               console.error(err);
               setRequestStatus('IDLE');
            }
        }
     };
     socket.on("connection_accepted", onAccepted);
  };

  if (isHostFlow) {
     return (
       <div className="w-full text-center animate-in fade-in zoom-in-95 duration-300 space-y-6">
         <div>
            <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Online Setup</h2>
            <p className="text-lg text-neutral-500 font-medium mb-8">Waiting for players to request to join you...</p>
         </div>

         {pendingJoiner ? (
           <div className="bg-white p-6 rounded-2xl shadow-lg border border-indigo-100 flex flex-col gap-4">
             <div className="flex items-center justify-center gap-3">
               <User className="w-6 h-6 text-indigo-600" />
               <span className="text-xl font-bold text-neutral-800">{pendingJoiner.name}</span>
               <span className="text-neutral-500">wants to join!</span>
             </div>
             <div className="flex gap-2">
               <button onClick={() => setPendingJoiner(null)} className="flex-1 py-3 bg-neutral-100 text-neutral-700 font-bold rounded-xl hover:bg-neutral-200">
                 Decline
               </button>
               <button onClick={() => createHostOfferForJoiner(pendingJoiner.id)} className="flex-[2] py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:bg-indigo-700">
                 Accept & Connect
               </button>
             </div>
           </div>
         ) : (
           <div className="p-8 border-2 border-dashed border-neutral-300 rounded-2xl flex flex-col items-center gap-4 text-neutral-500">
              <ShieldCheck className="w-10 h-10 text-neutral-400 animate-pulse" />
              <p className="font-bold">Listening on Local Network</p>
           </div>
         )}
         
         <button onClick={onCancel} className="mt-8 text-neutral-400 font-medium hover:text-neutral-600">Back</button>
       </div>
     );
  }

  // Joiner view
  return (
    <div className="w-full text-center animate-in fade-in zoom-in-95 duration-300 space-y-6">
       <div>
          <h2 className="text-3xl font-display font-bold mb-2 tracking-tight text-neutral-900">Available Hosts</h2>
          <p className="text-lg text-neutral-500 font-medium mb-8">Select a host on your local network to join.</p>
       </div>
       
       <div className="space-y-3">
         {hosts.length === 0 ? (
           <div className="p-8 border border-neutral-200 rounded-2xl bg-white/50 text-neutral-400 font-medium">
             No hosts found on this network.
           </div>
         ) : (
           hosts.map(h => (
             <button 
               key={h.id} 
               onClick={() => {
                   if (window.confirm(`Do you want to join host: ${h.name}?`)) {
                      handleJoinHost(h.id);
                   }
               }}
               disabled={requestStatus !== 'IDLE'}
               className="w-full p-4 bg-white border border-neutral-200 rounded-2xl shadow-sm hover:border-indigo-300 hover:shadow-md transition-all flex justify-between items-center group disabled:opacity-50"
             >
                <div className="flex items-center gap-3">
                   <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
                      <Gamepad2 className="w-5 h-5"/>
                   </div>
                   <span className="font-bold text-lg text-neutral-800">{h.name}</span>
                </div>
                <ArrowRight className="w-5 h-5 text-neutral-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
             </button>
           ))
         )}
       </div>

       {requestStatus === 'CLIENT_REQUESTED' && (
         <div className="p-4 bg-indigo-50 text-indigo-700 font-bold rounded-xl animate-pulse">
           Request sent, waiting for host...
         </div>
       )}

       <button onClick={onCancel} className="mt-8 text-neutral-400 font-medium hover:text-neutral-600">Back</button>
    </div>
  );
}
