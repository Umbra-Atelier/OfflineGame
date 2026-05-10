import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import { Camera, Video, VideoOff, RefreshCw } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (errorMessage: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [hasRequestedPerms, setHasRequestedPerms] = useState(false);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scannerRef.current = new Html5Qrcode("qr-reader-custom");
    
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
         scannerRef.current.stop().then(() => {
           scannerRef.current?.clear();
         }).catch(console.error);
      }
    };
  }, []);

  const requestCameras = async () => {
    setHasRequestedPerms(true);
    setErrorMsg(null);
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        setCameras(devices);
        
        // Find best match for "back" camera
        const backCamera = devices.find(d => 
          d.label.toLowerCase().includes('back') || 
          d.label.toLowerCase().includes('environment') ||
          d.label.toLowerCase().includes('rear')
        );
        const defaultCam = backCamera ? backCamera.id : devices[0].id;
        setSelectedCameraId(defaultCam);
        
        startScanning(defaultCam);
      } else {
        setErrorMsg("No cameras found on your device.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Camera permission denied. Please allow permissions, take a photo, or paste the code directly.");
      if (onError) onError("Camera permission denied.");
    }
  };

  const startScanning = async (cameraId: string) => {
    if (!scannerRef.current) return;
    
    try {
      if (scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
      
      setErrorMsg(null);
      await scannerRef.current.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          if (scannerRef.current?.isScanning) {
            scannerRef.current.stop().catch(console.error);
          }
          setIsScanning(false);
          onScan(decodedText);
        },
        (errorMessage) => {
          // ignore read errors (happens constantly until QR is found)
        }
      );
      setIsScanning(true);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Failed to start camera: ${err.message || err}`);
      setIsScanning(false);
    }
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    if (isScanning) {
      startScanning(newId);
    }
  };

  const stopScanning = async () => {
    if (!scannerRef.current || !scannerRef.current.isScanning) return;
    try {
      await scannerRef.current.stop();
      setIsScanning(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !scannerRef.current) return;

    setErrorMsg(null);
    try {
      if (scannerRef.current.isScanning) {
        await scannerRef.current.stop();
        setIsScanning(false);
      }
      
      const decodedText = await scannerRef.current.scanFile(file, true);
      onScan(decodedText);
    } catch (err) {
      console.error(err);
      setErrorMsg("No QR code found in the image. Please try again or paste the code directly.");
      if (onError) onError("Failed to detect QR in image.");
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      
      {/* Scanner Window */}
      <div className="w-full bg-white overflow-hidden rounded-xl shadow-lg border border-neutral-200 flex flex-col items-center">
        
        <div id="qr-reader-custom" className="w-full min-h-[300px] flex items-center justify-center bg-black relative">
           {/* If not scanning and haven't requested perms, show start button overlay */}
           {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900">
                {!hasRequestedPerms ? (
                  <button 
                    onClick={requestCameras}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-full font-bold shadow-lg hover:bg-indigo-700 transition"
                  >
                    <Video className="w-5 h-5"/> Start Camera
                  </button>
                ) : (
                  <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-3">
                    <VideoOff className="w-12 h-12 text-slate-600" />
                    <p className="text-sm">{errorMsg || "Camera stopped"}</p>
                    {cameras.length > 0 && !errorMsg && (
                      <button onClick={() => startScanning(selectedCameraId)} className="mt-2 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm">
                        Resume
                      </button>
                    )}
                  </div>
                )}
              </div>
           )}
        </div>

        {/* Camera Selector */}
        {cameras.length > 0 && (
          <div className="w-full p-3 bg-slate-100 border-t border-slate-200 flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Camera</label>
            <select 
              value={selectedCameraId}
              onChange={handleCameraChange}
              className="w-full p-2 bg-white border border-slate-300 rounded text-sm text-slate-700 outline-none"
            >
              {cameras.map(cam => (
                <option key={cam.id} value={cam.id}>{cam.label || `Camera ${cam.id.substring(0, 5)}`}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-2 w-full">
         <button 
           onClick={() => {
              if (isScanning) stopScanning();
              fileInputRef.current?.click();
           }} 
           className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition shadow-sm"
         >
            <Camera className="w-5 h-5"/> Scan Photo
         </button>
         <input 
           type="file" 
           accept="image/*" 
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
