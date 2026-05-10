import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, RefreshCw, VideoOff, QrCode } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafId = useRef<number | null>(null);

  const startCamera = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // MUST have these for mobile browsers to allow playback
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play();
        setIsScanning(true);
        requestAnimationFrame(tick);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Camera access denied or unavailable. Please use the "Scan Photo" button or paste the text directly.');
      setIsScanning(false);
    }
  };

  const stopCamera = () => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  };

  useEffect(() => {
    // Automatically try starting the camera
    startCamera();
    return () => stopCamera();
  }, []);

  const tick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        // Only set intrinsic sizes if they change to prevent clearing canvas
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
           canvas.width = video.videoWidth;
           canvas.height = video.videoHeight;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          
          if (code && code.data && code.data.length > 50) {
            stopCamera();
            onScan(code.data);
            return;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    
    if (isScanning || videoRef.current?.srcObject) {
      rafId.current = requestAnimationFrame(tick);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      if (event.target?.result) {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const maxDim = 1000;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
               width = Math.round((width * maxDim) / height);
               height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (code && code.data && code.data.length > 50) {
              stopCamera();
              onScan(code.data);
            } else {
              setErrorMsg('No QR code found in the image. Please try a clearer photo or paste the code below.');
            }
          }
        };
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      {/* Scanner Window */}
      <div className="w-full relative min-h-[300px] overflow-hidden rounded-2xl shadow-lg border-2 border-neutral-200 bg-slate-900 flex flex-col items-center justify-center">
        {isScanning ? (
           <>
              <video 
                ref={videoRef} 
                className="absolute inset-0 w-full h-full object-cover" 
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 border-[4px] border-indigo-500/80 m-6 rounded-xl z-10 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
              <div className="absolute inset-0 bg-indigo-500/10 pointer-events-none animate-pulse" />
           </>
        ) : (
           <div className="p-8 text-center text-slate-300 flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-2">
                 <VideoOff className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-sm px-4 leading-relaxed font-medium">{errorMsg || "Camera stopped. Tap below to resume or choose a photo."}</p>
           </div>
        )}
      </div>

      <div className="flex gap-3 w-full mt-2">
         {!isScanning && (
           <button 
             onClick={startCamera} 
             className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4 bg-slate-800 text-slate-200 rounded-2xl font-bold hover:bg-slate-700 transition shadow-sm active:scale-95 border-b-4 border-slate-900"
           >
              <RefreshCw className="w-5 h-5"/> 
              <span className="text-sm">Start Camera</span>
           </button>
         )}
         <button 
           onClick={() => fileInputRef.current?.click()} 
           className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition shadow-sm active:scale-95 border-b-4 border-indigo-800"
         >
            <Camera className="w-5 h-5"/> 
            <span className="text-sm">Scan Photo</span>
         </button>
         <input 
           type="file" 
           accept="image/*" 
           ref={fileInputRef} 
           onChange={handleFileUpload} 
           className="hidden" 
         />
      </div>
      
      <div className="w-full p-5 bg-white border border-slate-200 rounded-2xl shadow-sm mt-4">
        <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
           <QrCode className="w-4 h-4 text-slate-400" />
           Paste code manually
        </h3>
        <div className="flex flex-col gap-3">
          <input 
            type="text" 
            placeholder="Paste the block of text here..." 
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 bg-slate-50 transition-all font-mono"
          />
          <button 
            onClick={() => manualInput.length > 50 && onScan(manualInput)}
            disabled={manualInput.length < 50}
            className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-[0.98]"
          >
            Connect Manually
          </button>
        </div>
      </div>
    </div>
  );
}
