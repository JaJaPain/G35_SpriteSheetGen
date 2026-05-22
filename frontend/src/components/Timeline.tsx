import React, { useEffect } from 'react';
import { Play, Pause, FastForward, SkipBack, Layers } from 'lucide-react';

interface TimelineProps {
  frames: string[];
  currentFrameIndex: number;
  spriteId: string;
  isPlaying: boolean;
  fps: number;
  onionSkinPrev: boolean;
  onionSkinNext: boolean;
  onionSkinOpacity: number;
  onSelectFrame: (index: number) => void;
  onTogglePlay: () => void;
  onFpsChange: (fps: number) => void;
  onToggleOnionSkinPrev: () => void;
  onToggleOnionSkinNext: () => void;
  onOnionSkinOpacityChange: (opacity: number) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  frames,
  currentFrameIndex,
  spriteId,
  isPlaying,
  fps,
  onionSkinPrev,
  onionSkinNext,
  onionSkinOpacity,
  onSelectFrame,
  onTogglePlay,
  onFpsChange,
  onToggleOnionSkinPrev,
  onToggleOnionSkinNext,
  onOnionSkinOpacityChange,
}) => {
  
  // Playback timer loop
  useEffect(() => {
    if (!isPlaying || frames.length === 0) return;

    const intervalMs = 1000 / fps;
    const timer = setInterval(() => {
      const nextIndex = (currentFrameIndex + 1) % frames.length;
      onSelectFrame(nextIndex);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, frames, currentFrameIndex, fps]);

  const handleStep = (dir: 'prev' | 'next') => {
    if (frames.length === 0) return;
    if (dir === 'prev') {
      const idx = currentFrameIndex === 0 ? frames.length - 1 : currentFrameIndex - 1;
      onSelectFrame(idx);
    } else {
      const idx = (currentFrameIndex + 1) % frames.length;
      onSelectFrame(idx);
    }
  };

  return (
    <div className="glass-panel p-4 flex flex-col gap-3 select-none" style={{ borderTop: '1px solid var(--border-color)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }}>
      {/* Controls & Settings Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
        {/* Playback Buttons */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => onSelectFrame(0)} 
            className="btn-icon tooltip" 
            data-tooltip="Reset to Frame 0"
            disabled={frames.length === 0}
          >
            <SkipBack size={16} />
          </button>
          <button 
            onClick={() => handleStep('prev')} 
            className="btn-icon"
            disabled={frames.length === 0}
          >
            <FastForward size={16} style={{ transform: 'scaleX(-1)' }} />
          </button>
          
          <button 
            onClick={onTogglePlay} 
            className="btn-primary w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
            disabled={frames.length === 0}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>

          <button 
            onClick={() => handleStep('next')} 
            className="btn-icon"
            disabled={frames.length === 0}
          >
            <FastForward size={16} />
          </button>
        </div>

        {/* Playback speed slider */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60 font-mono">FPS:</span>
          <input 
            type="range" 
            min="1" 
            max="30" 
            value={fps} 
            onChange={(e) => onFpsChange(parseInt(e.target.value))}
            className="w-32"
          />
          <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-mono">
            {fps} FPS
          </span>
        </div>

        {/* Onion Skin controls */}
        <div className="flex items-center gap-3 glass-panel px-3 py-1.5 border-white/5">
          <div className="flex items-center gap-1">
            <Layers size={14} className="text-white/40" />
            <span className="text-xs text-white/60 font-medium mr-2">Onion Skin:</span>
          </div>
          
          <button 
            onClick={onToggleOnionSkinPrev}
            className={`text-xs px-2.5 py-1 rounded ${onionSkinPrev ? 'btn-primary' : 'bg-white/5 border-transparent'}`}
          >
            Prev Frame
          </button>
          
          <button 
            onClick={onToggleOnionSkinNext}
            className={`text-xs px-2.5 py-1 rounded ${onionSkinNext ? 'btn-primary' : 'bg-white/5 border-transparent'}`}
          >
            Next Frame
          </button>
          
          <div className="w-[1px] bg-white/10 h-4 mx-1"></div>
          
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/40 font-mono">Opacity:</span>
            <input 
              type="range" 
              min="0.1" 
              max="0.9" 
              step="0.05"
              value={onionSkinOpacity} 
              onChange={(e) => onOnionSkinOpacityChange(parseFloat(e.target.value))}
              className="w-16"
            />
            <span className="text-[10px] text-indigo-300 font-mono">{(onionSkinOpacity * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* Frame Strip Slider */}
      <div className="min-h-[72px] w-full flex gap-2 overflow-x-auto py-1 items-center bg-black/40 rounded-lg p-2 border border-white/5">
        {frames.length === 0 ? (
          <div className="text-xs text-white/30 w-full text-center py-4 italic">
            No frames extracted yet. Complete the generation phase to display the timeline.
          </div>
        ) : (
          frames.map((frameFile, index) => {
            const isSelected = index === currentFrameIndex;
            return (
              <div 
                key={frameFile}
                onClick={() => onSelectFrame(index)}
                className={`relative flex-shrink-0 w-[72px] h-[48px] rounded border transition-all cursor-pointer overflow-hidden flex items-center justify-center ${
                  isSelected 
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/10' 
                    : 'border-white/10 bg-white/5 hover:border-white/30'
                }`}
              >
                {/* Frame index indicator */}
                <div className="absolute top-0.5 left-1 z-10 text-[9px] font-mono text-white/50 bg-black/60 px-1 rounded">
                  {index}
                </div>
                
                {/* Frame thumbnail image */}
                <img 
                  src={`http://localhost:8000/frames/${spriteId}/${frameFile}`}
                  alt={`Frame ${index}`}
                  className="object-contain max-w-full max-h-full opacity-80"
                  loading="lazy"
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
