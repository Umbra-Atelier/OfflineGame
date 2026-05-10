import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Image as ImageIcon, VideoOff, RefreshCw } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (errorMessage: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasCameraPerms, setHasCameraPerms] = useState<boolean | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>(0);

  const startVideoContext = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true"); // required to tell iOS safari we don't want fullscreen
        await videoRef.current.play();
        setHasCameraPerms(true);
        setIsScanning(true);
        scanFrame();
      }
    } catch (err: any) {
      console.error("Camera access failed", err);
      // Most likely iframe perms or user denial
      setHasCameraPerms(false);
      setErrorMsg("Camera permission denied or unavailable. Please use the 'Take Photo' button below, or paste the code directly.");
      if (onError) onError("Camera permission denied.");
    }
  };

  const stopVideoContext = () => {
    setIsScanning(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    // Try to auto-start. If it fails, users can use fallback.
    startVideoContext();
    return stopVideoContext;
  }, []);

  const scanFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    
    // Check if video is ready
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Match canvas to video dimensions
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });
        
        if (code && code.data) {
          stopVideoContext();
          onScan(code.data);
          return;
        }
      }
    }
    
    if (isScanning) {
      rafRef.current = requestAnimationFrame(scanFrame);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 800; // Resize if too large to prevent jsqr from hanging
        let width = img.width;
        let height = img.height;
        
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
        const ctx = canvas.getContext("2d");
        
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          
          if (code && code.data) {
            onScan(code.data);
          } else {
            setErrorMsg("No QR code found in the image. Please try again or paste the code directly.");
            if (onError) onError("Failed to detect QR in image.");
          }
        }
      };
      if (event.target?.result) {
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      <div className="w-full relative min-h-[250px] bg-slate-900 overflow-hidden rounded-xl shadow-lg border border-slate-700 flex flex-col items-center justify-center">
        {hasCameraPerms === true ? (
           <>
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 border-4 border-indigo-500/50 m-8 rounded-xl z-10 pointer-events-none" />
           </>
        ) : (
           <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-3">
              <VideoOff className="w-12 h-12 text-slate-600" />
              <p className="text-sm">{errorMsg || "Connecting to camera..."}</p>
           </div>
        )}
      </div>

      <div className="flex gap-2 w-full">
         <button 
           onClick={() => startVideoContext()} 
           className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 font-bold hover:bg-slate-700 transition"
         >
            <RefreshCw className="w-4 h-4"/> Retry Camera
         </button>
         <button 
           onClick={() => fileInputRef.current?.click()} 
           className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition"
         >
            <Camera className="w-4 h-4"/> Take Photo
         </button>
         <input 
           type="file" 
           accept="image/*" 
           capture="environment" 
           ref={fileInputRef} 
           onChange={handleFileUpload} 
           className="hidden" 
         />
      </div>
      
      <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl shadow-sm mt-2">
        <h3 className="text-sm font-bold text-slate-700 mb-2">Can't scan the code?</h3>
        <div className="flex gap-2">
          <input 
            type="text" 
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Paste connection code here..." 
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button 
            onClick={() => onScan(manualInput)}
            disabled={!manualInput.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
