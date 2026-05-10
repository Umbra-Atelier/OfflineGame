import { Html5QrcodeScanner } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (errorMessage: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    // Only initialize once
    if (!scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        "qr-reader",
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          videoConstraints: {
            facingMode: "environment" // helps on safari
          }
        },
        /* verbose= */ false
      );

      scannerRef.current.render(
        (decodedText) => {
          onScan(decodedText);
        },
        (errorMessage) => {
          if (onError) onError(errorMessage);
        }
      );
    }

    return () => {
      // Clean up on unmount
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => {
          console.error("Failed to clear html5QrcodeScanner. ", error);
        });
        scannerRef.current = null;
      }
    };
  }, [onScan, onError]);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      <div id="qr-reader" className="w-full min-h-[300px] bg-white overflow-hidden rounded-xl shadow-lg border border-neutral-200"></div>
      
      <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl shadow-sm">
        <h3 className="text-sm font-bold text-slate-700 mb-2">Camera not working?</h3>
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
