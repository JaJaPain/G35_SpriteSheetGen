import { useState, useEffect } from 'react';
import { 
  Sliders, Download, CheckCircle2, 
  XCircle, Loader2, Sparkles, Move, Eraser, Edit, RefreshCw, Wand2, Info,
  Save, Check, Grid, ChevronDown, ChevronUp
} from 'lucide-react';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { Timeline } from './components/Timeline';

interface OffsetItem {
  frameIndex: number;
  dx: number;
  dy: number;
}

interface SpriteData {
  id: string;
  original_filename: string;
  processed_filename: string;
  dominant_color: [number, number, number];
  background_name: string;
  background_rgb: [number, number, number];
  prompt: string;
  seed: number | null;
  video_path: string;
  status: 'pending' | 'generated' | 'verified' | 'failed_verification' | 'failed_frame_extraction';
  verification: {
    passed: boolean;
    analysis: string;
    is_visible?: boolean;
    is_animating?: boolean;
    is_corrupted?: boolean;
  } | null;
  has_frames: boolean;
  frames: string[];
  offsets: OffsetItem[];
}

export default function App() {
  const [sprites, setSprites] = useState<SpriteData[]>([]);
  const [selectedSpriteId, setSelectedSpriteId] = useState<string | null>(null);
  const [isQcExpanded, setIsQcExpanded] = useState<boolean>(false);
  
  // Selection and editor states
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(10);
  
  // Onion skin configurations
  const [onionSkinPrev, setOnionSkinPrev] = useState<boolean>(true);
  const [onionSkinNext, setOnionSkinNext] = useState<boolean>(false);
  const [onionSkinOpacity, setOnionSkinOpacity] = useState<number>(0.3);
  
  // Canvas editing configurations
  const [activeTool, setActiveTool] = useState<'pan' | 'brush' | 'eraser' | 'wand' | 'select'>('pan');
  const [brushSize, setBrushSize] = useState<number>(4);
  const [brushColor, setBrushColor] = useState<string>('#ffffff');
  const [wandTolerance, setWandTolerance] = useState<number>(15);
  
  // Save/Export states
  const [isSavingOffsets, setIsSavingOffsets] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportResponse, setExportResponse] = useState<any | null>(null);
  const [exportTolerance, setExportTolerance] = useState<number>(20);
  const [exportPadding, setExportPadding] = useState<number>(4);
  const [exportType, setExportType] = useState<string>('spritesheet');
  
  // Global loading states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const fetchSprites = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('http://localhost:8000/api/sprites');
      const data = await res.json();
      setSprites(data);
      
      // Auto-select first sprite if none selected
      if (data.length > 0 && !selectedSpriteId) {
        setSelectedSpriteId(data[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch sprites:', e);
      setStatusMessage('API server offline. Start server by running uvicorn.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSprites();
  }, []);

  const selectedSprite = sprites.find(s => s.id === selectedSpriteId) || null;

  // Handle frame updates (drawing, erase, magic wand) on the frontend state
  const handleFrameUpdate = (index: number, _dataUrl: string) => {
    // Currently, local updates are managed on the canvas image element cache inside CanvasWorkspace.
    // In a production studio, we could send this patch to the backend.
    console.log(`Frame ${index} modified on frontend canvas.`);
  };

  // Local offset manipulation
  const handleOffsetChange = (frameIndex: number, dx: number, dy: number) => {
    if (!selectedSpriteId) return;
    setSprites(prevSprites => 
      prevSprites.map(sprite => {
        if (sprite.id !== selectedSpriteId) return sprite;
        
        const existingOffsets = [...sprite.offsets];
        const offsetIdx = existingOffsets.findIndex(o => o.frameIndex === frameIndex);
        
        if (offsetIdx >= 0) {
          existingOffsets[offsetIdx] = { frameIndex, dx, dy };
        } else {
          existingOffsets.push({ frameIndex, dx, dy });
        }
        
        return {
          ...sprite,
          offsets: existingOffsets
        };
      })
    );
  };

  const handleSaveOffsets = async () => {
    if (!selectedSprite) return;
    
    try {
      setIsSavingOffsets(true);
      const res = await fetch(`http://localhost:8000/api/sprite/${selectedSprite.id}/save-offsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsets: selectedSprite.offsets })
      });
      
      if (res.ok) {
        setStatusMessage('Offsets saved successfully!');
        setTimeout(() => setStatusMessage(''), 3000);
      } else {
        throw new Error('Failed to save');
      }
    } catch (e) {
      console.error(e);
      alert('Error saving offsets to server');
    } finally {
      setIsSavingOffsets(false);
    }
  };

  const handleExport = async () => {
    if (!selectedSprite) return;
    
    try {
      setIsExporting(true);
      setExportResponse(null);
      
      const res = await fetch(`http://localhost:8000/api/sprite/${selectedSprite.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tolerance: exportTolerance,
          export_type: exportType,
          padding: exportPadding
        })
      });
      
      if (res.ok) {
        const result = await res.json();
        setExportResponse(result);
      } else {
        throw new Error('Export failed');
      }
    } catch (e) {
      console.error(e);
      alert('Error exporting transparent spritesheet');
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusBadge = (status: string, _passed: boolean | undefined) => {
    switch (status) {
      case 'verified':
        return <span className="flex items-center gap-1 text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 size={12} /> Verified</span>;
      case 'failed_verification':
        return <span className="flex items-center gap-1 text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full font-medium"><XCircle size={12} /> QC Fail</span>;
      case 'generated':
        return <span className="flex items-center gap-1 text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium"><RefreshCw size={12} className="animate-spin-slow" /> Awaiting QC</span>;
      case 'pending':
      default:
        return <span className="flex items-center gap-1 text-[11px] bg-zinc-500/20 text-zinc-300 border border-zinc-500/30 px-2 py-0.5 rounded-full font-medium"><Loader2 size={12} className="animate-spin" /> In Progress</span>;
    }
  };

  return (
    <div className="app-container">
      {/* Top Header Navigation */}
      <header className="app-header">
        <div className="logo-container">
          <Sparkles className="text-indigo-400 animate-pulse" size={24} />
          <h1 className="logo-text">AI Sprite Animation Studio</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {statusMessage && (
            <span className="text-xs font-medium text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-900/30 flex items-center gap-1.5">
              <Check size={14} /> {statusMessage}
            </span>
          )}
          <button onClick={fetchSprites} className="btn-icon tooltip" data-tooltip="Refresh Studio Data">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {/* Main Studio Workspace Grid */}
      <div className={`studio-grid ${selectedSprite ? 'has-right-sidebar' : ''}`}>
        
        {/* Left Sidebar: Sprite List */}
        <aside className="sidebar p-4 border-r border-white/5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-white/40 tracking-wider uppercase">Active Sprite Queue</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-white/10 text-white/75">{sprites.length} Sprites</span>
          </div>
          
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30 py-12">
                <Loader2 className="animate-spin text-indigo-400" size={24} />
                <span className="text-xs">Loading studio assets...</span>
              </div>
            ) : sprites.length === 0 ? (
              <div className="text-xs text-white/30 text-center py-12 italic">
                No sprites found. Run backend pipeline to start.
              </div>
            ) : (
              sprites.map((sprite) => {
                const isSelected = sprite.id === selectedSpriteId;
                return (
                  <div
                    key={sprite.id}
                    onClick={() => {
                      setSelectedSpriteId(sprite.id);
                      setCurrentFrameIndex(0);
                      setExportResponse(null);
                    }}
                    className={`glass-panel p-3 cursor-pointer flex flex-col gap-2.5 transition-all hover:translate-x-0.5 ${
                      isSelected 
                        ? 'border-indigo-500 bg-indigo-950/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                        : 'hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate">
                        <div className="font-semibold text-sm truncate text-white/90">{sprite.original_filename}</div>
                        <div className="text-[11px] text-white/40 font-mono mt-0.5">{sprite.id}</div>
                      </div>
                      {getStatusBadge(sprite.status, sprite.verification?.passed)}
                    </div>

                    <div className="flex items-center gap-3 justify-between text-xs text-white/50 border-t border-white/5 pt-2 font-mono">
                      <span>Seed: {sprite.seed || 'N/A'}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `rgb(${sprite.background_rgb.join(',')})` }}></span>
                        <span className="capitalize">{sprite.background_name}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Model Status Card */}
          {selectedSprite && (
            <div className={`glass-panel p-3 border-indigo-950 bg-indigo-950/10 flex flex-col gap-2 flex-shrink-0 transition-all ${
              isQcExpanded ? 'max-h-[30%]' : 'max-h-[42px]'
            } overflow-hidden`}>
              <div 
                className="flex items-center justify-between text-xs font-semibold text-indigo-300 cursor-pointer select-none"
                onClick={() => setIsQcExpanded(!isQcExpanded)}
              >
                <div className="flex items-center gap-1.5">
                  <Info size={14} /> Gemma 4 QC Report
                </div>
                {isQcExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </div>
              {isQcExpanded && (
                <div className="overflow-y-auto flex flex-col gap-2 flex-1 pt-1">
                  {selectedSprite.verification ? (
                    <div className="text-xs flex flex-col gap-1.5">
                      <div className="text-white/80 font-medium">
                        {selectedSprite.verification.passed ? '✅ Passed animation verification' : '❌ Failed animation verification'}
                      </div>
                      <p className="text-white/40 italic text-[11px] leading-relaxed">
                        "{selectedSprite.verification.analysis}"
                      </p>
                    </div>
                  ) : (
                    <div className="text-xs text-white/30 italic">
                      Run verification script to inspect generated walk frames.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Center Canvas Work Area + Bottom Timeline */}
        {selectedSprite ? (
          <>
            <main className="workspace-panel">
              {/* Top Workspace Canvas */}
              <div className="relative flex-1 w-full h-full">
                <CanvasWorkspace
                  currentFrameIndex={currentFrameIndex}
                  frames={selectedSprite.frames}
                  offsets={selectedSprite.offsets}
                  spriteId={selectedSprite.id}
                  activeTool={activeTool}
                  brushSize={brushSize}
                  brushColor={brushColor}
                  onionSkinPrev={onionSkinPrev}
                  onionSkinNext={onionSkinNext}
                  onionSkinOpacity={onionSkinOpacity}
                  wandTolerance={wandTolerance}
                  onFrameUpdate={handleFrameUpdate}
                  onOffsetChange={handleOffsetChange}
                />
                
                {/* Floating Editor Tool Drawer (Left side of Canvas) */}
                <div className="absolute top-20 left-4 z-10 glass-panel p-2 flex flex-col gap-2">
                  <button 
                    onClick={() => setActiveTool('pan')} 
                    className={`btn-icon tooltip ${activeTool === 'pan' ? 'btn-primary' : ''}`}
                    data-tooltip="Pan & Navigation"
                  >
                    <Move size={16} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('brush')} 
                    className={`btn-icon tooltip ${activeTool === 'brush' ? 'btn-primary' : ''}`}
                    data-tooltip="Draw Brush"
                  >
                    <Edit size={16} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('eraser')} 
                    className={`btn-icon tooltip ${activeTool === 'eraser' ? 'btn-primary' : ''}`}
                    data-tooltip="Eraser Tool"
                  >
                    <Eraser size={16} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('wand')} 
                    className={`btn-icon tooltip ${activeTool === 'wand' ? 'btn-primary' : ''}`}
                    data-tooltip="Magic Wand (Keyer)"
                  >
                    <Wand2 size={16} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('select')} 
                    className={`btn-icon tooltip ${activeTool === 'select' ? 'btn-primary' : ''}`}
                    data-tooltip="Copy Bounding Box"
                  >
                    <Grid size={16} />
                  </button>

                  {/* Additional parameters depending on tool */}
                  {(activeTool === 'brush' || activeTool === 'eraser') && (
                    <div className="border-t border-white/5 pt-2 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-white/40 font-mono">Size</span>
                      <input 
                        type="range" 
                        min="1" 
                        max="20" 
                        value={brushSize} 
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-12"
                      />
                      {activeTool === 'brush' && (
                        <input 
                          type="color" 
                          value={brushColor} 
                          onChange={(e) => setBrushColor(e.target.value)}
                          className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer rounded"
                        />
                      )}
                    </div>
                  )}

                  {activeTool === 'wand' && (
                    <div className="border-t border-white/5 pt-2 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-white/40 font-mono">Tol</span>
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        value={wandTolerance} 
                        onChange={(e) => setWandTolerance(parseInt(e.target.value))}
                        className="w-12"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Playback Timeline Panel */}
              <div className="w-full">
                <Timeline
                  frames={selectedSprite.frames}
                  currentFrameIndex={currentFrameIndex}
                  spriteId={selectedSprite.id}
                  isPlaying={isPlaying}
                  fps={fps}
                  onionSkinPrev={onionSkinPrev}
                  onionSkinNext={onionSkinNext}
                  onionSkinOpacity={onionSkinOpacity}
                  onSelectFrame={setCurrentFrameIndex}
                  onTogglePlay={() => setIsPlaying(!isPlaying)}
                  onFpsChange={setFps}
                  onToggleOnionSkinPrev={() => setOnionSkinPrev(!onionSkinPrev)}
                  onToggleOnionSkinNext={() => setOnionSkinNext(!onionSkinNext)}
                  onOnionSkinOpacityChange={setOnionSkinOpacity}
                />
              </div>
            </main>

            {/* Right Sidebar: Adjustments & Export */}
            <aside className="right-sidebar p-4 flex flex-col gap-4 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-white/5 pb-2 flex-shrink-0">
                <h3 className="text-xs font-bold text-white/80 uppercase tracking-wider">Adjustment & Export</h3>
                <button 
                  onClick={handleSaveOffsets} 
                  className="btn-success px-2.5 py-1 text-xs"
                  disabled={isSavingOffsets}
                >
                  {isSavingOffsets ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Offsets
                </button>
              </div>

              {/* Prompt box */}
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-bold text-white/40 tracking-wide uppercase">Walk Direction Prompt</span>
                <div className="bg-black/30 border border-white/5 p-2 rounded-lg text-xs leading-relaxed text-indigo-200">
                  "{selectedSprite.prompt}"
                </div>
              </div>

              {/* Offset Correction Panel */}
              <div className="flex flex-col gap-2 flex-shrink-0">
                <span className="text-[10px] font-bold text-white/40 tracking-wide uppercase">Offset Correction Nudges</span>
                <div className="grid grid-cols-3 gap-1 w-32 mx-auto mt-1">
                  <div></div>
                  <button onClick={() => handleOffsetChange(currentFrameIndex, selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0, (selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0) - 1)} className="btn-icon w-full p-1"><Sliders size={12} className="rotate-90" /></button>
                  <div></div>
                  <button onClick={() => handleOffsetChange(currentFrameIndex, (selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0) - 1, selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0)} className="btn-icon w-full p-1"><Sliders size={12} style={{ transform: 'scaleX(-1)' }} /></button>
                  <div className="flex items-center justify-center text-[10px] font-mono text-white/30">Nudge</div>
                  <button onClick={() => handleOffsetChange(currentFrameIndex, (selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0) + 1, selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0)} className="btn-icon w-full p-1"><Sliders size={12} /></button>
                  <div></div>
                  <button onClick={() => handleOffsetChange(currentFrameIndex, selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0, (selectedSprite.offsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0) + 1)} className="btn-icon w-full p-1"><Sliders size={12} className="-rotate-90" /></button>
                  <div></div>
                </div>
              </div>

              {/* Export Options Form */}
              <div className="flex flex-col gap-3.5 border-t border-white/5 pt-3 flex-shrink-0">
                <span className="text-[10px] font-bold text-white/40 tracking-wide uppercase">Export Generator Settings</span>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white/60">Tolerance (Background removal)</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="range" 
                      min="5" 
                      max="80" 
                      value={exportTolerance}
                      onChange={(e) => setExportTolerance(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-xs font-mono w-6 text-right text-indigo-300">{exportTolerance}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white/60">Padding around character (px)</label>
                  <input 
                    type="number" 
                    min="0" 
                    max="32" 
                    value={exportPadding}
                    onChange={(e) => setExportPadding(parseInt(e.target.value))}
                    className="w-full text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white/60">Export Target Layout</label>
                  <select 
                    value={exportType}
                    onChange={(e) => setExportType(e.target.value)}
                    className="w-full text-xs"
                  >
                    <option value="spritesheet">Horizontal Spritesheet (Horizontal Strip)</option>
                    <option value="sequence">Transparent PNG Sequence</option>
                    <option value="both">Both (Sheet + Sequence)</option>
                  </select>
                </div>

                <button 
                  onClick={handleExport} 
                  className="btn-primary w-full mt-1.5 text-xs py-2"
                  disabled={isExporting}
                >
                  {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
                  {isExporting ? 'Generating Transparent Canvas...' : 'Compile & Export Sprite'}
                </button>
              </div>

              {/* Export Response Display */}
              {exportResponse && (
                <div className="glass-panel p-3 border-emerald-950 bg-emerald-950/10 flex flex-col gap-2 text-xs flex-shrink-0">
                  <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 size={14} /> Export Completed
                  </div>
                  <div className="text-[11px] text-white/60 font-mono">
                    Dimensions: {exportResponse.dimensions.width}x{exportResponse.dimensions.height}px
                  </div>
                  
                  <div className="flex flex-col gap-1.5 mt-1">
                    {exportResponse.export_paths.spritesheet && (
                      <a 
                        href={`http://localhost:8000${exportResponse.export_paths.spritesheet}`}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="btn-success text-center text-xs py-1.5 px-3 flex items-center justify-center gap-1.5 no-underline cursor-pointer"
                      >
                        <Download size={12} /> Download Spritesheet
                      </a>
                    )}
                    {exportResponse.export_paths.zip && (
                      <a 
                        href={`http://localhost:8000${exportResponse.export_paths.zip}`}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary text-center text-xs py-1.5 px-3 flex items-center justify-center gap-1.5 no-underline cursor-pointer"
                      >
                        <Download size={12} /> Download ZIP Sequence
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-white/40 mt-1 leading-relaxed text-center">
                    Saved to {selectedSprite.id} exports directory.
                  </p>
                </div>
              )}
            </aside>
          </>
        ) : (
          <div className="workspace-panel items-center justify-center bg-[#04060b] text-white/30 text-sm italic">
            Select a sprite from the queue to load canvas workspace.
          </div>
        )}
      </div>
    </div>
  );
}

