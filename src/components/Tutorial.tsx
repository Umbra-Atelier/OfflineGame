import { motion } from 'motion/react';
import { Smartphone, WifiOff, QrCode, Play, Users, Globe, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

export function Tutorial({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "1. Install the App",
      desc: "For the best offline experience, install this website to your home screen using your browser's 'Add to Home Screen' or 'Install App' option. Alternatively, if you load the page once while online, it will work offline after.",
      icon: <Globe className="w-12 h-12 text-blue-500" />
    },
    {
      title: "2. Turn on Host Hotspot",
      desc: "The Host needs to turn OFF their Wi-Fi and Data, then turn ON their Mobile Hotspot. This creates a local network without needing the internet.",
      icon: <WifiOff className="w-12 h-12 text-purple-500" />
    },
    {
      title: "3. Connect Joiner",
      desc: "The Joiner needs to turn OFF their Data, then connect their Wi-Fi to the Host's Mobile Hotspot.",
      icon: <Users className="w-12 h-12 text-indigo-500" />
    },
    {
      title: "4. Scan Codes",
      desc: "Both players open the installed app. Host clicks 'Host Game' and Joiner clicks 'Join Game'. You'll scan each other's QR codes to connect!",
      icon: <QrCode className="w-12 h-12 text-green-500" />
    }
  ];

  return (
    <div className="w-full max-w-md mx-auto min-h-[60vh] flex flex-col justify-center p-6 sm:p-8 space-y-8 bg-white/50 backdrop-blur-sm rounded-3xl shadow-sm border border-neutral-200/60 transition-all">
      <div className="text-center">
        <h2 className="text-3xl font-display font-bold text-neutral-900 mb-2 tracking-tight">How to Play Offline</h2>
        <div className="flex justify-center flex-col items-center mt-8">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-100 inline-block mb-6 transform transition-transform hover:scale-105">
              {steps[step].icon}
            </div>
            <h3 className="text-xl font-display font-bold text-neutral-800 mb-3 tracking-tight">{steps[step].title}</h3>
            <p className="text-neutral-600 text-center leading-relaxed h-28 font-medium">
              {steps[step].desc}
            </p>
        </div>
      </div>

      <div className="flex gap-2 justify-center py-4">
        {steps.map((_, i) => (
          <div key={i} className={`h-2.5 rounded-full transition-all duration-300 ${i === step ? 'w-10 bg-indigo-600 shadow-sm' : 'w-2.5 bg-neutral-200'}`} />
        ))}
      </div>

      <div className="flex justify-between w-full pt-4">
        <button 
          onClick={() => step > 0 && setStep(step - 1)}
          className={`px-5 py-3 font-medium rounded-xl transition-colors ${step === 0 ? 'text-transparent pointer-events-none' : 'text-neutral-500 hover:bg-neutral-100'}`}
          disabled={step === 0}
        >
          Back
        </button>
        
        {step < steps.length - 1 ? (
          <button 
            onClick={() => setStep(step + 1)}
            className="px-6 py-3 bg-neutral-900 text-white font-bold rounded-xl shadow-lg shadow-neutral-900/10 flex items-center gap-2 hover:bg-black transition-all active:scale-[0.98]"
          >
            Next <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button 
            onClick={onComplete}
            className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 flex items-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.98]"
          >
            Got it <CheckCircle2 className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
