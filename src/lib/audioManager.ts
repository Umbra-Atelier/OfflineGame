import * as Tone from 'tone';

let currentTrack: string | null = null;
let synths: any[] = [];
let loops: any[] = [];
let isMuted = false;
let clickSynth: Tone.MembraneSynth | null = null;

export const setupAudio = async () => {
  try {
    if (Tone.context.state !== 'running') {
      // Browsers will often block this if there was no prior interaction, 
      // generating a warning. We expect this.
      await Tone.start();
    }
  } catch (e) {
    // Suppress
  }
};

export const setMuted = (muted: boolean) => {
  isMuted = muted;
  Tone.Destination.mute = muted;
};

export const triggerHapticClick = async () => {
  try {
    // Real physical haptic feedback on mobile devices
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(15); // Short, crisp 15ms vibrate feels like a premium button click
    }
    
    // Complementary auditory click for immersion
    if (!isMuted) {
      if (Tone.context.state !== 'running') {
        await Tone.start();
        // If a track is queued but not playing because context wasn't running, start it
        if (currentTrack) {
          const track = currentTrack as any;
          currentTrack = null;
          playMusic(track);
        }
      }

      if (!clickSynth) {
        clickSynth = new Tone.MembraneSynth({ 
          pitchDecay: 0.02, 
          envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.01 } 
        }).toDestination();
        clickSynth.volume.value = -15; // Very quiet tactile sound
      }
      clickSynth.triggerAttackRelease("C1", "64n");
    }
  } catch (e) {
    // Ignore errors for devices that block haptics/audio without interaction
  }
};

export const stopMusic = () => {
  Tone.Transport.stop();
  Tone.Transport.cancel(0);
  loops.forEach(l => l.dispose());
  synths.forEach(s => s.dispose());
  loops = [];
  synths = [];
  currentTrack = null;
};

export const playMusic = async (track: any) => {
  if (currentTrack === track) return; // Already playing
  if (isMuted) return;
  
  stopMusic();
  currentTrack = track;

  try {
    // Wait for context to definitely be running
    if (Tone.context.state !== 'running') {
       await Tone.start();
    }

    if (track === 'LOBBY') {
      // Very chill, atmospheric lo-fi chords
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.5, decay: 2, sustain: 0.3, release: 1 }
      }).toDestination();
      synth.volume.value = -15;
      synths.push(synth);

      const chords = [
        ["C4", "E4", "G4", "B4"],
        ["F3", "A3", "C4", "E4"],
        ["A3", "C4", "E4", "G4"],
        ["G3", "B3", "D4", "F#4"]
      ];

      const seq = new Tone.Sequence((time, chord) => {
        synth.triggerAttackRelease(chord, "2n", time);
      }, chords, "1m");
      
      loops.push(seq);
      seq.start(0);
      Tone.Transport.bpm.value = 65;

    } else if (track === 'TAP_WAR') {
      // Intense, fast-paced electronic bassline
      const synth = new Tone.MonoSynth({
        oscillator: { type: 'square' },
        filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
      }).toDestination();
      synth.volume.value = -12;
      synths.push(synth);
      
      const seq = new Tone.Sequence((time, note) => {
        if (note) synth.triggerAttackRelease(note, "16n", time);
      }, ["C2", "C2", ["C2", "C2"], "D#2", "F2", null, "G1", "A#1"], "4n");
      
      loops.push(seq);
      seq.start(0);
      Tone.Transport.bpm.value = 140;

    } else if (track === 'PONG') {
      // Retro 8-bit jumpy melody
      const synth = new Tone.Synth({ 
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.2, release: 0.5 }
      }).toDestination();
      synth.volume.value = -12;
      synths.push(synth);
      
      const seq = new Tone.Sequence((time, note) => {
         synth.triggerAttackRelease(note, "8n", time);
      }, ["C4", "G4", "C5", "G4", "D#4", "A#4", "D#5", "A#4"], "4n");
      
      loops.push(seq);
      seq.start(0);
      Tone.Transport.bpm.value = 135;

    } else if (track === 'CHESS') {
      // Slow, intellectual classical arpeggio
      const synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.1, decay: 1, sustain: 0.5, release: 2 }
      }).toDestination();
      synth.volume.value = -15;
      synths.push(synth);
      
      const pattern = new Tone.Pattern((time, note) => {
          synth.triggerAttackRelease(note, "4n", time);
      }, ["E3", "A3", "C4", "E4", "C4", "A3"], "upDown"); // A minor pattern
      
      loops.push(pattern);
      pattern.start(0);
      Tone.Transport.bpm.value = 90;

    } else if (track === 'HIDDEN_ROLE') {
      // Spooky, suspenseful, dark drone
      const synth = new Tone.FMSynth({
          harmonicity: 0.5,
          modulationIndex: 10,
          oscillator: { type: "sine" },
          envelope: { attack: 2, decay: 1, sustain: 1, release: 4 }
      }).toDestination();
      synth.volume.value = -18;
      synths.push(synth);
      
      const loop = new Tone.Loop(time => {
          synth.triggerAttackRelease("C2", "2m", time);
          synth.triggerAttackRelease("C#2", "2m", time + Tone.Time("2m").toSeconds());
      }, "4m");
      
      loops.push(loop);
      loop.start(0);
      Tone.Transport.bpm.value = 60;
      
    } else if (track === 'ROCKET_LEAGUE' || track === 'CARD_BATTLE' || track === 'LASER_TAG') {
      // Fast paced EDM feel
      const synth = new Tone.FMSynth({
        harmonicity: 1.5,
        modulationIndex: 5,
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0, release: 0.2 }
      }).toDestination();
      synth.volume.value = -15;
      synths.push(synth);
      
      const seq = new Tone.Sequence((time, note) => {
        if (note) synth.triggerAttackRelease(note, "8n", time);
      }, ["C3", "C3", "D#3", "F3", "G3", "C4", "A#3", "G3"], "8n");
      
      loops.push(seq);
      seq.start(0);
      Tone.Transport.bpm.value = 150;
    }
    
    Tone.Transport.start();
  } catch (e) {
    console.error("Music playback failed", e);
  }
};

let effectSynth: Tone.PolySynth | null = null;
let noiseSynth: Tone.NoiseSynth | null = null;

const getEffectSynth = () => {
    if (isMuted) return null;
    if (!effectSynth) {
        effectSynth = new Tone.PolySynth(Tone.Synth, {
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 1 }
        }).toDestination();
        effectSynth.volume.value = -10;
        
        noiseSynth = new Tone.NoiseSynth({
            noise: { type: "white" },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.05 }
        }).toDestination();
        noiseSynth.volume.value = -15;
    }
    return effectSynth;
}

export const playJumpSound = () => {
    const synth = getEffectSynth();
    if (synth) synth.triggerAttackRelease("C4", "16n");
}

export const playBoostSound = () => {
    const synth = getEffectSynth();
    if (noiseSynth) noiseSynth.triggerAttackRelease("16n");
}

export const playGoalSound = () => {
    const synth = getEffectSynth();
    if (synth) synth.triggerAttackRelease(["C4", "E4", "G4", "C5"], "2n");
}

export const playHitSound = () => {
    const synth = getEffectSynth();
    if (synth) synth.triggerAttackRelease("C2", "32n");
}

let magicSynth: Tone.Synth | null = null;
const getMagicSynth = () => {
    if (isMuted) return null;
    if (!magicSynth) {
        magicSynth = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.1, sustain: 0.2, release: 1 }
        }).toDestination();
        magicSynth.volume.value = -8;
    }
    return magicSynth;
}

export const playMagicTileNote = (note: string) => {
    const synth = getMagicSynth();
    if (synth) synth.triggerAttackRelease(note, "8n");
}

export const playSound = (freq: number | string, type: Tone.ToneOscillatorType, duration: number) => {
    if (isMuted) return;
    try {
        const synth = new Tone.Synth({
            oscillator: { type: type as any },
            envelope: { attack: 0.01, decay: duration, sustain: 0, release: 0.1 }
        }).toDestination();
        synth.volume.value = -12;
        synth.triggerAttackRelease(freq, duration);
        setTimeout(() => synth.dispose(), duration * 1000 + 500);
    } catch (e) {}
}

