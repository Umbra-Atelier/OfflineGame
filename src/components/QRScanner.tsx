import React, { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QrCode } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const [manualInput, setManualInput] = useState('');

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      {/* Scanner Window */}
      <div className="w-full relative min-h-[300px] overflow-hidden rounded-2xl shadow-lg border-2 border-neutral-200 bg-black flex flex-col items-center justify-center">
         <Scanner 
            onScan={(result) => {
               if (result && result.length > 0 && result[0].rawValue) {
                  onScan(result[0].rawValue);
               }
            }}
            onError={(e) => onError && onError(e instanceof Error ? e.message : String(e))}
            formats={['qr_code']}
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

