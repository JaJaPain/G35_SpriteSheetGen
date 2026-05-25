import { useState, useEffect } from 'react';
import { 
  Sliders, Download, CheckCircle2, 
  XCircle, Loader2, Sparkles, RefreshCw, Info,
  Save, Check, ChevronDown, ChevronUp, Plus, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { Timeline } from './components/Timeline';

interface OffsetItem {
  frameIndex: number;
  dx: number;
  dy: number;
  tolerance?: number;
  override_color?: [number, number, number];
}

interface RejectedAttempt {
  id: string;
  sprite_name: string;
  seed: number;
  video_path: string;
  frames_dir: string;
  status: string;
  verification: {
    passed: boolean;
    analysis: string;
  } | null;
  frames: string[];
  offsets: OffsetItem[];
}

interface AttemptItem {
  seed: number;
  status: string;
  video_path: string;
  frames_dir: string;
  verification: {
    passed: boolean;
    analysis: string;
  } | null;
  has_frames: boolean;
  frames: string[];
  offsets: OffsetItem[];
  is_good: boolean;
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
  frames_dir?: string;
  status: 'pending' | 'generated' | 'verified' | 'failed_verification' | 'failed_frame_extraction';
  verification: {
    passed: boolean;
    analysis: string;
  } | null;
  has_frames: boolean;
  frames: string[];
  offsets: OffsetItem[];
  rejected_attempts?: RejectedAttempt[];
  attempts?: AttemptItem[];
  good_seeds?: number[];
  rejected_seeds?: number[];
}

const rgbToHex = (rgb: number[] | null | undefined): string => {
  if (!rgb || rgb.length < 3) return '#ffffff';
  return '#' + rgb.slice(0, 3).map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

const hexToRgb = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
};

export default function App() {
  const [sprites, setSprites] = useState<SpriteData[]>([]);
  const [selectedSpriteId, setSelectedSpriteId] = useState<string | null>(null);
  const [isQcExpanded, setIsQcExpanded] = useState<boolean>(true);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState<boolean>(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState<boolean>(false);
  const [isOffsetsExpanded, setIsOffsetsExpanded] = useState<boolean>(true);
  const [isCandidatesExpanded, setIsCandidatesExpanded] = useState<boolean>(true);
  const [isExportExpanded, setIsExportExpanded] = useState<boolean>(true);
  
  // Selection and editor states
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(10);
  
  // Onion skin configurations
  const [onionSkinPrev, setOnionSkinPrev] = useState<boolean>(true);
  const [onionSkinNext, setOnionSkinNext] = useState<boolean>(false);
  const [onionSkinOpacity, setOnionSkinOpacity] = useState<number>(0.3);
  
  // Canvas editing configurations
  const [activeTool, setActiveTool] = useState<'pan' | 'halo' | 'eraser' | 'wand' | 'select'>('pan');
  const [brushSize, setBrushSize] = useState<number>(4);
  const [brushColor, setBrushColor] = useState<string>('#ffffff');
  const [wandTolerance, setWandTolerance] = useState<number>(15);
  
  // Save/Export states
  const [isSavingOffsets, setIsSavingOffsets] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportResponse, setExportResponse] = useState<any | null>(null);
  const [exportTolerance, setExportTolerance] = useState<number>(20);
  const [previewChromaKey, setPreviewChromaKey] = useState<boolean>(true);
  const [exportPadding, setExportPadding] = useState<number>(4);
  const [exportType, setExportType] = useState<string>('spritesheet');
  
  // Global loading states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Multi-project and pipeline states
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>(() => {
    return localStorage.getItem('selectedProject') || '';
  });
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [isCreatingProject, setIsCreatingProject] = useState<boolean>(false);
  const [pipelineStatus, setPipelineStatus] = useState<string>('idle');
  const [viewingAttempt, setViewingAttempt] = useState<RejectedAttempt | null>(null);
  const [selectedAttemptSeed, setSelectedAttemptSeed] = useState<number | null>(null);
  const [isFailedSeedsModalOpen, setIsFailedSeedsModalOpen] = useState<boolean>(false);

  const directions = ['front', 'back', '34front', '34back', 'side'];

  const getSpriteDirection = (spriteId: string): string => {
    const name = spriteId.toLowerCase();
    if (name.includes('34front')) return '34front';
    if (name.includes('34back')) return '34back';
    if (name.includes('front')) return 'front';
    if (name.includes('back')) return 'back';
    if (name.includes('side')) return 'side';
    return 'front';
  };

  const DIRECTION_LABELS: { [key: string]: string } = {
    front: 'Front Walk (0°)',
    back: 'Back Walk (180°)',
    '34front': '3/4 Front Walk (45°)',
    '34back': '3/4 Back Walk (135°)',
    side: 'Side Profile Walk (90°)'
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/projects');
      const data = await res.json();
      setProjects(data);
      if (data.length > 0 && !selectedProject) {
        setSelectedProject(data[0]);
        localStorage.setItem('selectedProject', data[0]);
      }
    } catch (e) {
      console.error('Failed to fetch projects:', e);
    }
  };

  const fetchSprites = async (proj = selectedProject) => {
    try {
      setIsLoading(true);
      const url = proj 
        ? `http://localhost:8000/api/sprites?project=${encodeURIComponent(proj)}`
        : 'http://localhost:8000/api/sprites';
      const res = await fetch(url);
      const data = await res.json();
      setSprites(data);
      
      // Auto-select first sprite if none selected
      if (data.length > 0) {
        if (selectedSpriteId) {
          const stillExists = data.some((s: SpriteData) => s.id === selectedSpriteId);
          if (!stillExists) {
            setSelectedSpriteId(data[0].id);
          }
        } else {
          setSelectedSpriteId(data[0].id);
        }
      } else {
        setSelectedSpriteId(null);
      }
    } catch (e) {
      console.error('Failed to fetch sprites:', e);
      setStatusMessage('API server offline. Start server by running uvicorn.');
    } finally {
      setIsLoading(false);
    }
  };

  const checkPipelineStatus = async (proj = selectedProject) => {
    if (!proj) return;
    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/pipeline-status`);
      const data = await res.json();
      setPipelineStatus(data.status);
    } catch (e) {
      console.error('Failed to check pipeline status:', e);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchSprites(selectedProject);
      checkPipelineStatus(selectedProject);
      setViewingAttempt(null);
    } else {
      setSprites([]);
      setSelectedSpriteId(null);
      setViewingAttempt(null);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (pipelineStatus === 'running' && selectedProject) {
      const interval = setInterval(() => {
        checkPipelineStatus(selectedProject);
        fetchSprites(selectedProject);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [pipelineStatus, selectedProject]);

  useEffect(() => {
    setViewingAttempt(null);
    setSelectedAttemptSeed(null);
  }, [selectedSpriteId]);

  const selectedSpriteRaw = sprites.find(s => s.id === selectedSpriteId) || null;
  const activeAttempt = selectedSpriteRaw?.attempts?.find(a => a.seed === selectedAttemptSeed) || 
                        selectedSpriteRaw?.attempts?.find(a => a.seed === selectedSpriteRaw.seed) || 
                        selectedSpriteRaw?.attempts?.[0] || 
                        null;
  const selectedSprite = selectedSpriteRaw ? {
    ...selectedSpriteRaw,
    seed: activeAttempt ? activeAttempt.seed : selectedSpriteRaw.seed,
    status: activeAttempt ? activeAttempt.status : selectedSpriteRaw.status,
    video_path: activeAttempt ? activeAttempt.video_path : selectedSpriteRaw.video_path,
    frames_dir: activeAttempt ? activeAttempt.frames_dir : selectedSpriteRaw.frames_dir,
    verification: activeAttempt ? activeAttempt.verification : selectedSpriteRaw.verification,
    has_frames: activeAttempt ? activeAttempt.has_frames : selectedSpriteRaw.has_frames,
    frames: activeAttempt ? activeAttempt.frames : selectedSpriteRaw.frames,
    offsets: activeAttempt ? activeAttempt.offsets : selectedSpriteRaw.offsets
  } : null;

  const handleFrameUpdate = async (index: number, dataUrl: string) => {
    if (!selectedSprite) return;
    const activeFramesDir = viewingAttempt ? viewingAttempt.frames_dir : selectedSprite.frames_dir;
    
    try {
      const params = new URLSearchParams();
      if (selectedProject) params.append('project', selectedProject);
      if (activeFramesDir) params.append('frames_dir', activeFramesDir);

      const res = await fetch(`http://localhost:8000/api/sprite/${selectedSprite.id}/frame/${index}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: dataUrl })
      });
      
      if (!res.ok) {
        throw new Error('Failed to save frame');
      }
    } catch (e) {
      console.error('Error saving frame updates to server:', e);
    }
  };

  const handleOffsetChange = (frameIndex: number, dx: number, dy: number) => {
    if (!selectedSpriteId) return;
    
    if (viewingAttempt) {
      // Modify offsets of viewing attempt
      setViewingAttempt(prev => {
        if (!prev) return null;
        const existingOffsets = [...prev.offsets];
        const offsetIdx = existingOffsets.findIndex(o => o.frameIndex === frameIndex);
        if (offsetIdx >= 0) {
          existingOffsets[offsetIdx] = { ...existingOffsets[offsetIdx], dx, dy };
        } else {
          existingOffsets.push({ frameIndex, dx, dy });
        }
        return { ...prev, offsets: existingOffsets };
      });
    } else {
      // Modify active sprite offsets
      setSprites(prevSprites => 
        prevSprites.map(sprite => {
          if (sprite.id !== selectedSpriteId) return sprite;
          
          const existingOffsets = [...sprite.offsets];
          const offsetIdx = existingOffsets.findIndex(o => o.frameIndex === frameIndex);
          
          if (offsetIdx >= 0) {
            existingOffsets[offsetIdx] = { ...existingOffsets[offsetIdx], dx, dy };
          } else {
            existingOffsets.push({ frameIndex, dx, dy });
          }
          
          return {
            ...sprite,
            offsets: existingOffsets
          };
        })
      );
    }
  };

  const handleUpdateFrameOverride = (field: 'tolerance' | 'override_color', value: any) => {
    if (!selectedSpriteId) return;
    const frameIndex = currentFrameIndex;
    
    // For override_color, if value is a hex string, convert it to [R, G, B]
    let processedValue = value;
    if (field === 'override_color' && typeof value === 'string' && value.startsWith('#')) {
      processedValue = hexToRgb(value);
    }

    const updateOffsetsList = (existingOffsets: any[]) => {
      const idx = existingOffsets.findIndex(o => o.frameIndex === frameIndex);
      if (idx >= 0) {
        const updated = { ...existingOffsets[idx] };
        if (processedValue === null) {
          delete updated[field];
        } else {
          updated[field] = processedValue;
        }
        const newList = [...existingOffsets];
        newList[idx] = updated;
        return newList;
      } else {
        if (processedValue === null) return existingOffsets;
        const newItem: any = { frameIndex, dx: 0, dy: 0 };
        newItem[field] = processedValue;
        return [...existingOffsets, newItem];
      }
    };

    if (viewingAttempt) {
      setViewingAttempt(prev => {
        if (!prev) return null;
        return {
          ...prev,
          offsets: updateOffsetsList(prev.offsets)
        };
      });
    } else {
      setSprites(prevSprites => 
        prevSprites.map(sprite => {
          if (sprite.id !== selectedSpriteId) return sprite;
          return {
            ...sprite,
            offsets: updateOffsetsList(sprite.offsets)
          };
        })
      );
    }
  };

  const handleSaveOffsets = async () => {
    if (!selectedSprite) return;
    const activeFramesDir = viewingAttempt ? viewingAttempt.frames_dir : selectedSprite.frames_dir;
    const activeOffsets = viewingAttempt ? viewingAttempt.offsets : selectedSprite.offsets;
    
    try {
      setIsSavingOffsets(true);
      const params = new URLSearchParams();
      if (selectedProject) params.append('project', selectedProject);
      if (activeFramesDir) params.append('frames_dir', activeFramesDir);

      const res = await fetch(`http://localhost:8000/api/sprite/${selectedSprite.id}/save-offsets?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsets: activeOffsets })
      });
      
      if (res.ok) {
        setStatusMessage('Offsets saved successfully!');
        setTimeout(() => setStatusMessage(''), 3000);
        if (selectedProject) fetchSprites(selectedProject);
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
    const activeFramesDir = viewingAttempt ? viewingAttempt.frames_dir : selectedSprite.frames_dir;
    
    try {
      setIsExporting(true);
      setExportResponse(null);
      
      const params = new URLSearchParams();
      if (selectedProject) params.append('project', selectedProject);
      if (activeFramesDir) params.append('frames_dir', activeFramesDir);

      const res = await fetch(`http://localhost:8000/api/sprite/${selectedSprite.id}/export?${params.toString()}`, {
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

  const handleRunPipeline = async (mode: 'initial' | 'regen' = 'initial', spriteName?: string) => {
    if (!selectedProject) return;
    try {
      setPipelineStatus('running');
      const params = new URLSearchParams();
      params.append('mode', mode);
      if (spriteName) {
        params.append('sprite', spriteName);
      }
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(selectedProject)}/run-pipeline?${params.toString()}`, {
        method: 'POST'
      });
      if (res.ok) {
        setStatusMessage(mode === 'regen' ? `Regeneration for ${spriteName} started.` : 'Initial pipeline run started.');
        setTimeout(() => setStatusMessage(''), 3000);
      } else {
        setPipelineStatus('idle');
      }
    } catch (e) {
      console.error(e);
      setPipelineStatus('idle');
      alert('Failed to start pipeline');
    }
  };

  const handleApproveSeed = async (spriteId: string, seed: number) => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(selectedProject)}/sprite/${spriteId}/seed/${seed}/approve`, {
        method: 'POST'
      });
      if (res.ok) {
        setStatusMessage(`Seed ${seed} marked as good globally!`);
        fetchSprites(selectedProject);
      } else {
        const err = await res.json();
        setStatusMessage(`Failed to approve seed: ${err.detail || res.statusText}`);
      }
    } catch (e) {
      console.error('Error approving seed:', e);
      setStatusMessage('Network error approving seed.');
    }
  };

  const handleRejectSeed = async (spriteId: string, seed: number) => {
    if (!selectedProject) return;
    if (!window.confirm(`Are you sure you want to delete attempt with seed ${seed}? This will permanently remove its files and blacklist the seed for this project.`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(selectedProject)}/sprite/${spriteId}/seed/${seed}/reject`, {
        method: 'POST'
      });
      if (res.ok) {
        setStatusMessage(`Seed ${seed} deleted and blacklisted.`);
        if (selectedAttemptSeed === seed) {
          setSelectedAttemptSeed(null);
        }
        fetchSprites(selectedProject);
      } else {
        const err = await res.json();
        setStatusMessage(`Failed to reject seed: ${err.detail || res.statusText}`);
      }
    } catch (e) {
      console.error('Error rejecting seed:', e);
      setStatusMessage('Network error rejecting seed.');
    }
  };

  const handleResetSprite = async (spriteId: string) => {
    if (!selectedProject) return;
    if (!confirm(`Are you sure you want to reject the current active loop and regenerate the '${spriteId}' walk cycle?`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(selectedProject)}/sprite/${spriteId}/reset`, {
        method: 'POST'
      });
      if (res.ok) {
        setViewingAttempt(null);
        setStatusMessage(`Walk cycle '${spriteId}' reset to pending.`);
        setTimeout(() => setStatusMessage(''), 3000);
        fetchSprites(selectedProject);
      } else {
        alert('Failed to reset sprite');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePromoteAttempt = async (spriteId: string, seed: number) => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(selectedProject)}/sprite/${spriteId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed })
      });
      if (res.ok) {
        setViewingAttempt(null);
        setStatusMessage(`Attempt with seed ${seed} promoted to active loop.`);
        setTimeout(() => setStatusMessage(''), 3000);
        fetchSprites(selectedProject);
      } else {
        alert('Failed to promote attempt');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    try {
      setIsCreatingProject(true);
      const res = await fetch('http://localhost:8000/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        setNewProjectName('');
        setIsCreateModalOpen(false);
        setStatusMessage(`Project "${name}" created and processed!`);
        setTimeout(() => setStatusMessage(''), 3000);
        
        // Refresh project list & select new project
        const projRes = await fetch('http://localhost:8000/api/projects');
        const data = await projRes.json();
        setProjects(data);
        setSelectedProject(name);
        localStorage.setItem('selectedProject', name);
      } else {
        const errorData = await res.json();
        alert(errorData.detail || 'Failed to create project');
      }
    } catch (e) {
      console.error(e);
      alert('Error creating project');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const renderCreateModal = () => (
    <div className="modal-overlay">
      <div className="glass-panel p-6 max-w-sm w-full border-white/10 flex flex-col gap-4 project-modal-shadow">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white/90">Create New Project</h3>
          <button onClick={() => setIsCreateModalOpen(false)} className="text-white/40 hover:text-white/80">
            <XCircle size={18} />
          </button>
        </div>
        
        <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/60 font-medium">Project Name</label>
            <input 
              type="text" 
              value={newProjectName} 
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="e.g. PixelHero"
              required
              disabled={isCreatingProject}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 w-full"
            />
          </div>
          
          <div className="text-[11px] text-indigo-300 bg-indigo-950/20 border border-indigo-900/30 p-2.5 rounded-lg leading-relaxed">
            Note: This will automatically copy default sprites from <strong>TestSprites/</strong> into your project workspace and run-process backgrounds in-process.
          </div>
          
          <button 
            type="submit" 
            className="btn-primary w-full py-2 flex items-center justify-center gap-2"
            disabled={isCreatingProject}
          >
            {isCreatingProject ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Initializing & Seeding...</span>
              </>
            ) : (
              <span>Create Project</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );

  const renderFailedSeedsModal = () => {
    if (!selectedSprite || !selectedSprite.attempts) return null;
    
    const failedAttempts = selectedSprite.attempts.filter(
      (attempt) =>
        attempt.status !== 'pending' &&
        attempt.status !== 'generated' &&
        !(attempt.status === 'verified' && attempt.verification?.passed)
    );

    return (
      <div className="modal-overlay" onClick={() => setIsFailedSeedsModalOpen(false)}>
        <div 
          className="glass-panel p-6 max-w-lg w-full border-white/10 flex flex-col gap-4 project-modal-shadow max-h-[85%] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="text-rose-400" size={18} />
              <h3 className="text-sm font-bold text-white/90">
                QC-Rejected Seeds ({failedAttempts.length})
              </h3>
            </div>
            <button 
              onClick={() => setIsFailedSeedsModalOpen(false)} 
              className="text-white/40 hover:text-white/80 p-1 rounded-lg hover:bg-white/5 border-none transition-all"
            >
              <XCircle size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-0">
            {failedAttempts.length === 0 ? (
              <div className="text-xs text-white/40 italic text-center py-6">
                No rejected seeds found for this sprite.
              </div>
            ) : (
              failedAttempts.map((attempt) => {
                const isCurrentActive = activeAttempt?.seed === attempt.seed;
                return (
                  <div
                    key={attempt.seed}
                    className={`p-3 rounded-lg border text-xs flex flex-col gap-2 transition-all ${
                      isCurrentActive
                        ? 'border-indigo-500 bg-indigo-950/30'
                        : 'border-white/5 bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white/90">Seed {attempt.seed}</span>
                        {attempt.is_good && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-bold border border-amber-500/10">
                            ★ Good Seed
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded border bg-rose-500/20 text-rose-300 border-rose-500/10 font-medium">
                        Failed QC
                      </span>
                    </div>

                    {attempt.verification?.analysis && (
                      <p className="text-[10px] text-white/50 italic leading-relaxed bg-black/20 p-2 rounded border border-white/5 font-mono">
                        "{attempt.verification.analysis}"
                      </p>
                    )}

                    <div className="flex items-center gap-2 justify-end border-t border-white/5 pt-2 mt-1">
                      <button
                        onClick={() => {
                          setSelectedAttemptSeed(attempt.seed);
                          setIsFailedSeedsModalOpen(false);
                        }}
                        className={`py-1 px-3 rounded font-bold text-[10px] transition-all flex items-center gap-1 ${
                          isCurrentActive
                            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/20 cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                        disabled={isCurrentActive}
                      >
                        View on Canvas
                      </button>
                      
                      <button
                        onClick={() => {
                          handleApproveSeed(selectedSprite.processed_filename, attempt.seed);
                        }}
                        className={`py-1 px-3 rounded font-bold text-[10px] transition-all flex items-center gap-1 ${
                          attempt.is_good
                            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/20 cursor-default'
                            : 'bg-amber-600 hover:bg-amber-500 text-white'
                        }`}
                        disabled={attempt.is_good}
                      >
                        ★ Mark as Good
                      </button>
                      
                      <button
                        onClick={() => {
                          handleRejectSeed(selectedSprite.processed_filename, attempt.seed);
                        }}
                        className="py-1 px-3 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] transition-all flex items-center justify-center gap-1"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  const getStatusBadge = (status: string, _passed?: boolean) => {
    switch (status) {
      case 'verified':
        return <span className="flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold"><CheckCircle2 size={11} /> Verified</span>;
      case 'failed_verification':
        return <span className="flex items-center gap-1 text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full font-bold"><XCircle size={11} /> QC Fail</span>;
      case 'generated':
        return <span className="flex items-center gap-1 text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold"><RefreshCw size={11} className="animate-spin-slow" /> Awaiting QC</span>;
      case 'pending':
      default:
        return <span className="flex items-center gap-1 text-[10px] bg-zinc-500/20 text-zinc-300 border border-zinc-500/30 px-2 py-0.5 rounded-full font-bold"><Loader2 size={11} /> Pending</span>;
    }
  };

  // Welcome page if no project is active or selected
  if (!selectedProject) {
    return (
      <div className="app-container flex flex-col min-h-screen bg-[#04060b] text-white">
        <header className="app-header">
          <div className="logo-container">
            <Sparkles className="text-indigo-400 animate-pulse" size={24} />
            <h1 className="logo-text">AI Sprite Animation Studio</h1>
          </div>
        </header>
        
        <main className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="glass-panel p-8 max-w-md w-full text-center flex flex-col items-center gap-6 border-white/10 shadow-[0_0_50px_rgba(99,102,241,0.1)]">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
              <Sparkles size={32} className="animate-pulse" />
            </div>
            
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-bold">Welcome to Sprite Studio</h2>
              <p className="text-xs text-white/50 leading-relaxed">
                Create a new project or select an existing one to generate, verify, and edit walk cycle animations.
              </p>
            </div>

            {projects.length > 0 && (
              <div className="flex flex-col gap-2 w-full">
                <label className="text-xs text-white/40 text-left font-semibold">Select Existing Project</label>
                <select 
                  value={selectedProject} 
                  onChange={(e) => {
                    setSelectedProject(e.target.value);
                    localStorage.setItem('selectedProject', e.target.value);
                  }}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-semibold cursor-pointer w-full focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Choose a Project --</option>
                  {projects.map((proj) => (
                    <option key={proj} value={proj}>{proj}</option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="flex flex-col gap-2 w-full">
              {projects.length > 0 && <div className="text-xs text-white/30 font-medium">Or start a new one</div>}
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="btn-primary w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Sparkles size={16} /> Create New Project
              </button>
            </div>
          </div>
        </main>

        {isCreateModalOpen && renderCreateModal()}
      </div>
    );
  }

  // Active workspace inputs
  const activeFrames = viewingAttempt ? viewingAttempt.frames : (selectedSprite ? selectedSprite.frames : []);
  const activeOffsets = viewingAttempt ? viewingAttempt.offsets : (selectedSprite ? selectedSprite.offsets : []);
  const activeFramesDir = viewingAttempt ? viewingAttempt.frames_dir : (selectedSprite ? selectedSprite.frames_dir : '');

  return (
    <div className="app-container">
      {/* Top Header Navigation */}
      <header className="app-header">
        <div className="logo-container">
          <Sparkles className="text-indigo-400 animate-pulse" size={24} />
          <h1 className="logo-text">AI Sprite Animation Studio</h1>
        </div>

        {/* Project Switcher & Status controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50 font-medium">Project:</span>
            <select 
              value={selectedProject} 
              onChange={(e) => {
                setSelectedProject(e.target.value);
                localStorage.setItem('selectedProject', e.target.value);
              }}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-semibold cursor-pointer focus:outline-none focus:border-indigo-500"
            >
              {projects.map((proj) => (
                <option key={proj} value={proj}>{proj}</option>
              ))}
            </select>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
            >
              <Sparkles size={12} /> New Project
            </button>
          </div>

          {selectedProject && (
            <div className="flex items-center gap-2 bg-black/30 border border-white/5 px-3 py-1.5 rounded-lg">
              <div className={`w-2 h-2 rounded-full ${pipelineStatus === 'running' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
              <span className="text-xs text-white/70 font-mono capitalize">Pipeline: {pipelineStatus}</span>
              {pipelineStatus === 'running' && <Loader2 size={12} className="animate-spin text-amber-500" />}
            </div>
          )}

          {statusMessage && (
            <span className="text-xs font-medium text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-900/30 flex items-center gap-1.5">
              <Check size={14} /> {statusMessage}
            </span>
          )}
          
          <button onClick={() => fetchSprites(selectedProject)} className="btn-icon tooltip" data-tooltip="Refresh Studio Data">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {/* Main Studio Workspace Grid */}
      <div 
        className="studio-grid"
        style={{
          gridTemplateColumns: `${isLeftSidebarCollapsed ? '48px' : 'var(--sidebar-width)'} minmax(0, 1fr) ${
            selectedSprite ? (isRightSidebarCollapsed ? '48px' : 'var(--right-sidebar-width)') : '0px'
          }`
        }}
      >
        
        {/* Collapsed Left Sidebar Strip */}
        {isLeftSidebarCollapsed && (
          <div className="w-12 border-r border-white/5 bg-[#0a0f1d] flex flex-col items-center py-4 gap-4 flex-shrink-0 select-none">
            <button 
              onClick={() => setIsLeftSidebarCollapsed(false)} 
              className="p-2 hover:bg-white/5 rounded text-indigo-400 hover:text-indigo-300 transition-colors"
              title="Expand Sidebar"
            >
              <ChevronRight size={18} />
            </button>
            <div className="w-[1px] bg-white/10 h-6"></div>
            <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest writing-vertical rotate-180 select-none">
              Directions & Pipeline
            </span>
          </div>
        )}

        {/* Left Sidebar: Sprite Queue grouped by Direction */}
        {!isLeftSidebarCollapsed && (
          <aside className="sidebar p-4 border-r border-white/5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2 flex-shrink-0">
              <h3 className="text-xs font-bold text-white/80 uppercase tracking-wider">Directions & Pipeline</h3>
              <button 
                onClick={() => setIsLeftSidebarCollapsed(true)} 
                className="p-1 hover:bg-white/5 rounded text-white/50 hover:text-white transition-colors"
                title="Collapse Sidebar"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-1">
              {/* Project Pipeline Controller */}
              {selectedProject && (
                <div className="glass-panel p-3 border-indigo-900/30 bg-indigo-950/10 flex flex-col gap-2 flex-shrink-0">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-300">
                    <span>Pipeline Controller</span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono capitalize">{pipelineStatus}</span>
                  </div>
                  
                  {pipelineStatus === 'running' ? (
                    <button
                      disabled
                      className="btn-primary w-full py-2 flex items-center justify-center gap-1.5 opacity-60 cursor-not-allowed text-xs"
                    >
                      <Loader2 size={13} className="animate-spin" /> Generating...
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRunPipeline('initial')}
                      className="btn-primary w-full py-2 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                    >
                      <Sparkles size={13} /> Run Walk Cycle Generator
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-2">
                <h2 className="text-xs font-semibold text-white/40 tracking-wider uppercase">Directions Queue</h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-white/10 text-white/75">
                  {sprites.filter(s => s.status === 'verified').length} / 5 Done
                </span>
              </div>

              {isLoading && sprites.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30 py-12">
                  <Loader2 className="animate-spin text-indigo-400" size={24} />
                  <span className="text-xs">Loading sprites...</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {directions.map((dir) => {
                    const sprite = sprites.find(s => getSpriteDirection(s.id) === dir);
                    if (!sprite) {
                      return (
                        <div key={dir} className="glass-panel p-3 border-dashed border-white/5 opacity-55 flex flex-col gap-1 text-xs">
                          <span className="font-semibold text-white/50">{DIRECTION_LABELS[dir]}</span>
                          <span className="text-white/30 italic">No sprite available for this direction</span>
                        </div>
                      );
                    }
                    
                    const isSelected = sprite.id === selectedSpriteId;
                    const passedCount = sprite.attempts ? sprite.attempts.filter(a => a.status === 'verified' && a.verification?.passed).length : (sprite.status === 'verified' && sprite.verification?.passed ? 1 : 0);
                    const blacklistedCount = sprite.rejected_seeds ? sprite.rejected_seeds.length : 0;
                    
                    return (
                      <div
                        key={sprite.id}
                        onClick={() => {
                          setSelectedSpriteId(sprite.id);
                          setCurrentFrameIndex(0);
                          setExportResponse(null);
                        }}
                        className={`glass-panel p-3 cursor-pointer flex flex-col gap-2 transition-all hover:translate-x-0.5 ${
                          isSelected 
                            ? 'border-indigo-500 bg-indigo-950/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                            : 'hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate">
                            <div className="font-semibold text-[10px] text-white/40 tracking-wide uppercase">{DIRECTION_LABELS[dir]}</div>
                            <div className="font-bold text-sm truncate text-white/90 mt-0.5">{sprite.original_filename}</div>
                          </div>
                          {getStatusBadge(sprite.status, sprite.verification?.passed)}
                        </div>

                        <div className="flex items-center gap-3 justify-between text-[11px] text-white/50 border-t border-white/5 pt-2 font-mono">
                          <span>{passedCount}/6 Verified</span>
                          {blacklistedCount > 0 && (
                            <span className="bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                              {blacklistedCount} Blacklisted
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Model Status Card */}
            {selectedSprite && !viewingAttempt && (
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
                    {selectedSprite.status === 'pending' ? (
                      <div className="text-xs text-white/30 italic flex items-center gap-1.5">
                        <Loader2 size={12} className={pipelineStatus === 'running' ? 'animate-spin' : ''} />
                        {pipelineStatus === 'running' ? 'Generating walk cycle...' : 'Awaiting generation...'}
                      </div>
                    ) : selectedSprite.status === 'generated' ? (
                      <div className="text-xs text-white/30 italic flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" />
                        Awaiting QC verification report...
                      </div>
                    ) : selectedSprite.verification ? (
                      <div className="text-xs flex flex-col gap-1.5">
                        <div className="text-white/80 font-medium">
                          {selectedSprite.verification.passed ? '✅ Passed QC checks' : '❌ Failed QC checks'}
                        </div>
                        <p className="text-white/40 italic text-[11px] leading-relaxed">
                          "{selectedSprite.verification.analysis}"
                        </p>
                      </div>
                    ) : (
                      <div className="text-xs text-white/30 italic">
                        Run verification pipeline to inspect walk cycle frames.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        {/* Center Canvas Work Area + Bottom Timeline */}
        {selectedSprite ? (
          <>
            <main className="workspace-panel">
              {/* Banner if viewing a rejected attempt */}
              {viewingAttempt && (
                <div className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between text-xs text-amber-300">
                  <div className="flex items-center gap-2 font-medium">
                    <span>⚠️ Viewing QC-Rejected Attempt (Seed: {viewingAttempt.seed})</span>
                    <span className="text-[11px] text-white/50 font-mono">({viewingAttempt.verification?.analysis})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handlePromoteAttempt(selectedSprite.id, viewingAttempt.seed)}
                      className="btn-success px-3 py-1 text-xs font-bold flex items-center gap-1.5"
                    >
                      <CheckCircle2 size={13} /> Use This Attempt (Promote)
                    </button>
                    <button 
                      onClick={() => setViewingAttempt(null)}
                      className="bg-white/10 hover:bg-white/20 text-white px-3 py-1 text-xs rounded transition-all font-bold"
                    >
                      Back to Active Loop
                    </button>
                  </div>
                </div>
              )}

              {/* Top Workspace Canvas */}
              <div className="relative flex-1 w-full h-full">
                {activeFrames.length > 0 ? (
                  <CanvasWorkspace
                    currentFrameIndex={currentFrameIndex}
                    frames={activeFrames}
                    offsets={activeOffsets}
                    spriteId={selectedSprite.id}
                    framesDir={activeFramesDir}
                    activeTool={activeTool}
                    setActiveTool={setActiveTool}
                    brushSize={brushSize}
                    setBrushSize={setBrushSize}
                    brushColor={brushColor}
                    setBrushColor={setBrushColor}
                    onionSkinPrev={onionSkinPrev}
                    onionSkinNext={onionSkinNext}
                    onionSkinOpacity={onionSkinOpacity}
                    wandTolerance={wandTolerance}
                    setWandTolerance={setWandTolerance}
                    onFrameUpdate={handleFrameUpdate}
                    onOffsetChange={handleOffsetChange}
                    previewChromaKey={previewChromaKey}
                    chromaKeyColor={selectedSprite.background_rgb || null}
                    chromaKeyTolerance={exportTolerance}
                  />
                ) : (
                  <div className="workspace-panel items-center justify-center bg-[#04060b] text-white/50 text-center p-8 flex flex-col gap-4 w-full h-full">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400 animate-pulse">
                      <Loader2 size={32} />
                    </div>
                    <div className="flex flex-col gap-1.5 max-w-md">
                      <h3 className="text-base font-semibold text-white/95">
                        {selectedSprite.status === 'pending'
                          ? pipelineStatus === 'running'
                            ? 'Generation in Progress'
                            : 'Generation Pending'
                          : 'No Walk Cycle Frames Available'}
                      </h3>
                      <p className="text-xs text-white/40 leading-relaxed">
                        {selectedSprite.status === 'pending'
                          ? pipelineStatus === 'running'
                            ? 'The AI pipeline is currently generating this walk cycle attempt. Please wait a moment...'
                            : 'This candidate is queued for generation. Start the generation pipeline to process it.'
                          : `This direction is currently ${selectedSprite.status}. Run the Generator Pipeline to create a walk cycle video and extract its frames.`}
                      </p>
                    </div>
                    {selectedSprite.status === 'pending' && pipelineStatus !== 'running' && (
                      <button 
                        onClick={() => handleRunPipeline('initial')}
                        className="btn-primary mt-2 text-xs py-2 px-4 flex items-center gap-1.5"
                      >
                        <Sparkles size={14} /> Start Generation Pipeline
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Playback Timeline Panel */}
              <div className="w-full">
                <Timeline
                  frames={activeFrames}
                  currentFrameIndex={currentFrameIndex}
                  spriteId={selectedSprite.id}
                  framesDir={activeFramesDir}
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

            {/* Collapsed Right Sidebar Strip */}
            {selectedSprite && isRightSidebarCollapsed && (
              <div className="w-12 border-l border-white/5 bg-[#0a0f1d] flex flex-col items-center py-4 gap-4 flex-shrink-0 select-none">
                <button 
                  onClick={() => setIsRightSidebarCollapsed(false)} 
                  className="p-2 hover:bg-white/5 rounded text-indigo-400 hover:text-indigo-300 transition-colors"
                  title="Expand Sidebar"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="w-[1px] bg-white/10 h-6"></div>
                <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest writing-vertical select-none font-sans">
                  Adjustments & Export
                </span>
              </div>
            )}

            {/* Right Sidebar: Adjustments & Export */}
            {selectedSprite && !isRightSidebarCollapsed && (
              <aside className="right-sidebar p-4 flex flex-col gap-4 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-white/5 pb-2 flex-shrink-0">
                  <h3 className="text-xs font-bold text-white/80 uppercase tracking-wider">Adjustment & Export</h3>
                  <button 
                    onClick={() => setIsRightSidebarCollapsed(true)} 
                    className="p-1 hover:bg-white/5 rounded text-white/50 hover:text-white transition-colors"
                    title="Collapse Sidebar"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                {/* 1. Offsets & Adjustments collapsible panel */}
                <div className="border border-white/5 rounded-lg bg-black/10 overflow-hidden flex flex-col flex-shrink-0">
                  <div 
                    onClick={() => setIsOffsetsExpanded(!isOffsetsExpanded)}
                    className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 cursor-pointer select-none transition-all"
                  >
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders size={12} /> 1. Offsets & Adjustments
                    </span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveOffsets();
                        }} 
                        className="btn-success text-[10px] px-2 py-0.5"
                        disabled={isSavingOffsets || activeFrames.length === 0}
                      >
                        {isSavingOffsets ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                      </button>
                      {isOffsetsExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </div>
                  </div>

                  {isOffsetsExpanded && (
                    <div className="p-3 flex flex-col gap-4 border-t border-white/5 bg-black/20">
                      {/* Prompt box */}
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <span className="text-[9px] font-bold text-white/40 tracking-wide uppercase">Walk Direction Prompt</span>
                        <div className="bg-black/30 border border-white/5 p-2 rounded-lg text-xs leading-relaxed text-indigo-200 font-mono">
                          "{selectedSprite.prompt}"
                        </div>
                      </div>

                      {/* Nudge Control panel */}
                      {activeFrames.length > 0 && (
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <span className="text-[9px] font-bold text-white/40 tracking-wide uppercase">Offset Correction Nudges</span>
                          <div className="grid grid-cols-3 gap-1 w-32 mx-auto mt-1">
                            <div></div>
                            <button onClick={() => handleOffsetChange(currentFrameIndex, activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0, (activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0) - 1)} className="btn-icon w-full p-1"><Sliders size={12} className="rotate-90" /></button>
                            <div></div>
                            <button onClick={() => handleOffsetChange(currentFrameIndex, (activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0) - 1, activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0)} className="btn-icon w-full p-1"><Sliders size={12} style={{ transform: 'scaleX(-1)' }} /></button>
                            <div className="flex items-center justify-center text-[10px] font-mono text-white/30">Nudge</div>
                            <button onClick={() => handleOffsetChange(currentFrameIndex, (activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0) + 1, activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0)} className="btn-icon w-full p-1"><Sliders size={12} /></button>
                            <div></div>
                            <button onClick={() => handleOffsetChange(currentFrameIndex, activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dx || 0, (activeOffsets.find(o => o.frameIndex === currentFrameIndex)?.dy || 0) + 1)} className="btn-icon w-full p-1"><Sliders size={12} className="-rotate-90" /></button>
                            <div></div>
                          </div>
                        </div>
                      )}

                      {/* Frame-Specific Keying overrides */}
                      {activeFrames.length > 0 && (() => {
                        const currentOverride = activeOffsets.find(o => o.frameIndex === currentFrameIndex);
                        const hasCustomTolerance = currentOverride?.tolerance !== undefined;
                        const customToleranceValue = hasCustomTolerance ? currentOverride.tolerance : exportTolerance;
                        
                        const hasCustomColor = currentOverride?.override_color !== undefined;
                        const customColorHex = hasCustomColor 
                          ? rgbToHex(currentOverride.override_color!) 
                          : rgbToHex(selectedSprite.background_rgb || [255, 255, 255]);

                        return (
                          <div className="flex flex-col gap-2.5 border-t border-white/5 pt-3 flex-shrink-0">
                            <span className="text-[9px] font-bold text-white/40 tracking-wide uppercase">
                              Frame {currentFrameIndex} Keying Overrides
                            </span>
                            
                            {/* Tolerance Override */}
                            <div className="flex flex-col gap-1 bg-white/5 p-2 rounded-lg border border-white/5">
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={hasCustomTolerance}
                                    onChange={(e) => handleUpdateFrameOverride('tolerance', e.target.checked ? exportTolerance : null)}
                                    className="rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                                  />
                                  <span className="text-[11px] font-medium text-white/80">Override Tolerance</span>
                                </label>
                              </div>
                              <div className={`flex items-center gap-2 mt-1.5 transition-all duration-200 ${hasCustomTolerance ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                                <input 
                                  type="range" 
                                  min="5" 
                                  max="80" 
                                  value={customToleranceValue}
                                  disabled={!hasCustomTolerance}
                                  onChange={(e) => handleUpdateFrameOverride('tolerance', parseInt(e.target.value))}
                                  className="flex-1 h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer"
                                />
                                <span className="text-[11px] font-mono text-indigo-300 w-5 text-right font-bold">{customToleranceValue}</span>
                              </div>
                            </div>

                            {/* Color Override */}
                            <div className="flex flex-col gap-1 bg-white/5 p-2 rounded-lg border border-white/5">
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={hasCustomColor}
                                    onChange={(e) => handleUpdateFrameOverride('override_color', e.target.checked ? customColorHex : null)}
                                    className="rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                                  />
                                  <span className="text-[11px] font-medium text-white/80">Override BG Color</span>
                                </label>
                              </div>
                              <div className={`flex items-center gap-2 mt-1.5 transition-all duration-200 ${hasCustomColor ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                                <input 
                                  type="color" 
                                  value={customColorHex}
                                  disabled={!hasCustomColor}
                                  onChange={(e) => handleUpdateFrameOverride('override_color', e.target.value)}
                                  className="w-8 h-6 p-0 border-0 bg-transparent cursor-pointer rounded"
                                />
                                <span className="text-[11px] font-mono text-white/50">{customColorHex.toUpperCase()}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 2. Candidates & Seeds collapsible panel */}
                <div className="border border-white/5 rounded-lg bg-black/10 overflow-hidden flex flex-col flex-shrink-0">
                  <div 
                    onClick={() => setIsCandidatesExpanded(!isCandidatesExpanded)}
                    className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 cursor-pointer select-none transition-all"
                  >
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles size={12} /> 2. Candidates & Seeds
                    </span>
                    {isCandidatesExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </div>

                  {isCandidatesExpanded && (
                    <div className="p-3 flex flex-col gap-3 border-t border-white/5 bg-black/20">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-white/40 tracking-wide uppercase">
                          Candidates & Seeds
                        </span>
                        <button
                          onClick={() => handleRunPipeline('regen', selectedSprite.processed_filename)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                          disabled={pipelineStatus === 'running'}
                        >
                          <Plus size={10} /> Add 3 Candidates
                        </button>
                      </div>
                      
                      {selectedSprite.attempts && selectedSprite.attempts.length > 0 ? (
                        <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto pr-1">
                          {(() => {
                            const passedAttempts = selectedSprite.attempts.filter(
                              (attempt) =>
                                (attempt.status === 'verified' && attempt.verification?.passed) ||
                                attempt.status === 'pending' ||
                                attempt.status === 'generated'
                            );
                            const failedAttempts = selectedSprite.attempts.filter(
                              (attempt) =>
                                attempt.status !== 'pending' &&
                                attempt.status !== 'generated' &&
                                !(attempt.status === 'verified' && attempt.verification?.passed)
                            );

                            return (
                              <>
                                {failedAttempts.length > 0 && (
                                  <div
                                    onClick={() => setIsFailedSeedsModalOpen(true)}
                                    className="p-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/15 hover:border-rose-500/30 cursor-pointer flex items-center justify-between transition-all"
                                  >
                                    <div className="flex items-center gap-2 text-rose-300">
                                      <XCircle size={14} className="text-rose-400" />
                                      <span className="text-[11px] font-semibold">
                                        {failedAttempts.length} {failedAttempts.length === 1 ? 'video' : 'videos'} rejected by Gemma
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-rose-400 bg-rose-500/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                      View
                                    </span>
                                  </div>
                                )}

                                {passedAttempts.map((attempt) => {
                                  const isCurrentActive = activeAttempt?.seed === attempt.seed;
                                  const qcPassed = attempt.status === 'verified' && attempt.verification?.passed;
                                  
                                  return (
                                    <div
                                      key={attempt.seed}
                                      onClick={() => setSelectedAttemptSeed(attempt.seed)}
                                      className={`p-2 rounded-lg border text-xs cursor-pointer flex flex-col gap-1.5 transition-all ${
                                        isCurrentActive
                                          ? 'border-indigo-500 bg-indigo-950/20'
                                          : 'border-white/5 bg-white/5 hover:border-white/10 hover:bg-white/10'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-semibold text-white/80">Seed {attempt.seed}</span>
                                          {attempt.is_good && (
                                            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-bold flex items-center gap-0.5 border border-amber-500/10">
                                              ★ Good Seed
                                            </span>
                                          )}
                                        </div>
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                                          qcPassed 
                                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/10' 
                                            : attempt.status === 'pending' || attempt.status === 'generated'
                                              ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/10'
                                              : 'bg-rose-500/20 text-rose-300 border-rose-500/10'
                                        }`}>
                                          {qcPassed 
                                            ? 'Passed QC' 
                                            : attempt.status === 'pending' || attempt.status === 'generated'
                                              ? 'Pending' 
                                              : 'Failed QC'}
                                        </span>
                                      </div>

                                      {/* Show detailed controls and analysis if selected/active */}
                                      {isCurrentActive && (
                                        <div className="flex flex-col gap-2 border-t border-white/5 pt-2 mt-1">
                                          {attempt.verification?.analysis && (
                                            <p className="text-[10px] text-white/50 italic leading-relaxed bg-black/20 p-1.5 rounded border border-white/5">
                                              "{attempt.verification.analysis}"
                                            </p>
                                          )}
                                          <div className="flex items-center gap-1.5">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleApproveSeed(selectedSprite.processed_filename, attempt.seed);
                                              }}
                                              className={`flex-1 py-1 px-2 rounded font-bold text-[10px] transition-all flex items-center justify-center gap-1 ${
                                                attempt.is_good
                                                  ? 'bg-amber-600/30 text-amber-300 border border-amber-500/20 cursor-default'
                                                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                              }`}
                                              disabled={attempt.is_good}
                                            >
                                              ★ {attempt.is_good ? 'Good Approved' : 'Mark as Good'}
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRejectSeed(selectedSprite.processed_filename, attempt.seed);
                                              }}
                                              className="py-1 px-2 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] transition-all flex items-center justify-center gap-1"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="text-xs text-white/30 italic p-3 border border-white/5 rounded-lg bg-white/5 text-center">
                          No candidates generated yet.
                        </div>
                      )}

                      <button
                        onClick={() => handleResetSprite(selectedSprite.id)}
                        className="btn-danger w-full text-xs py-2 flex items-center justify-center gap-1.5 font-bold"
                        disabled={selectedSprite.status === 'pending' || pipelineStatus === 'running'}
                      >
                        <RefreshCw size={12} /> Reject & Reset Sprite
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. Export Options collapsible panel */}
                <div className="border border-white/5 rounded-lg bg-black/10 overflow-hidden flex flex-col flex-shrink-0">
                  <div 
                    onClick={() => setIsExportExpanded(!isExportExpanded)}
                    className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 cursor-pointer select-none transition-all"
                  >
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Download size={12} /> 3. Export settings
                    </span>
                    {isExportExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </div>

                  {isExportExpanded && (
                    <div className="p-3 flex flex-col gap-3.5 border-t border-white/5 bg-black/20">
                      {activeFrames.length > 0 ? (
                        <>
                          <span className="text-[9px] font-bold text-white/40 tracking-wide uppercase">Export Generator Settings</span>
                          
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

                          <div className="flex items-center gap-2 bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-lg">
                            <input 
                              type="checkbox" 
                              id="previewChromaKey"
                              checked={previewChromaKey}
                              onChange={(e) => setPreviewChromaKey(e.target.checked)}
                              className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
                            />
                            <label htmlFor="previewChromaKey" className="text-[11px] text-white/70 select-none cursor-pointer font-medium leading-none">
                              Preview Transparency in Editor
                            </label>
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/60">Padding around character (px)</label>
                            <input 
                              type="number" 
                              min="0" 
                              max="32" 
                              value={exportPadding}
                              onChange={(e) => setExportPadding(parseInt(e.target.value))}
                              className="w-full text-xs bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white font-medium"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/60">Export Target Layout</label>
                            <select 
                              value={exportType}
                              onChange={(e) => setExportType(e.target.value)}
                              className="w-full text-xs bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white font-medium"
                            >
                              <option value="spritesheet">Horizontal Spritesheet (Horizontal Strip)</option>
                              <option value="sequence">Transparent PNG Sequence</option>
                              <option value="both">Both (Sheet + Sequence)</option>
                            </select>
                          </div>

                          <button 
                            onClick={handleExport} 
                            className="btn-primary w-full mt-1.5 text-xs py-2 font-bold"
                            disabled={isExporting}
                          >
                            {isExporting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Download size={14} className="mr-1.5" />} 
                            {isExporting ? 'Generating...' : 'Compile & Export Sprite'}
                          </button>
                        </>
                      ) : (
                        <div className="text-xs text-white/30 italic text-center py-2">
                          No frames loaded to export.
                        </div>
                      )}

                      {/* Export Response Display */}
                      {exportResponse && (
                        <div className="p-3 border border-emerald-950 bg-emerald-950/20 rounded-lg flex flex-col gap-2 text-xs">
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
                                className="btn-success text-center text-xs py-1.5 px-3 flex items-center justify-center gap-1.5 no-underline cursor-pointer font-bold"
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
                                className="btn-primary text-center text-xs py-1.5 px-3 flex items-center justify-center gap-1.5 no-underline cursor-pointer font-bold"
                              >
                                <Download size={12} /> Download ZIP Sequence
                              </a>
                            )}
                          </div>
                          <p className="text-[9px] text-white/40 mt-1 leading-relaxed text-center font-medium">
                            Saved to {selectedSprite.id} exports.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            )}
          </>
        ) : (
          <div className="workspace-panel items-center justify-center bg-[#04060b] text-white/30 text-sm italic">
            Select a sprite direction from the queue to load canvas workspace.
          </div>
        )}
      </div>

      {isCreateModalOpen && renderCreateModal()}
      {isFailedSeedsModalOpen && renderFailedSeedsModal()}
    </div>
  );
}

