import React, { useRef, useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface OffsetItem {
  frameIndex: number;
  dx: number;
  dy: number;
}

interface CanvasWorkspaceProps {
  currentFrameIndex: number;
  frames: string[];
  offsets: OffsetItem[];
  spriteId: string;
  framesDir?: string;
  activeTool: 'brush' | 'eraser' | 'wand' | 'select' | 'pan';
  brushSize: number;
  brushColor: string;
  onionSkinPrev: boolean;
  onionSkinNext: boolean;
  onionSkinOpacity: number;
  wandTolerance: number;
  onFrameUpdate: (frameIndex: number, dataUrl: string) => void;
  onOffsetChange: (frameIndex: number, dx: number, dy: number) => void;
  previewChromaKey?: boolean;
  chromaKeyColor?: [number, number, number] | null;
  chromaKeyTolerance?: number;
}

export const CanvasWorkspace: React.FC<CanvasWorkspaceProps> = ({
  currentFrameIndex,
  frames,
  offsets,
  spriteId,
  framesDir,
  activeTool,
  brushSize,
  brushColor,
  onionSkinPrev,
  onionSkinNext,
  onionSkinOpacity,
  wandTolerance,
  onFrameUpdate,
  onOffsetChange,
  previewChromaKey = false,
  chromaKeyColor = null,
  chromaKeyTolerance = 20,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Canvas viewport state
  const [scale, setScale] = useState<number>(1.5);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  const [selectStart, setSelectStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [copiedBuffer, setCopiedBuffer] = useState<ImageData | null>(null);
  
  // Loaded images cache
  const [loadedImages, setLoadedImages] = useState<Dict<HTMLImageElement>>({});
  
  // Real-time chroma keying cache and revision
  const [rev, setRev] = useState<number>(0);
  const keyedCacheRef = useRef<Dict<HTMLCanvasElement>>({});
  
  // Clear cache when sprite, directory, tolerance, or color changes
  useEffect(() => {
    keyedCacheRef.current = {};
  }, [spriteId, framesDir, chromaKeyColor, chromaKeyTolerance]);

  const getKeyedCanvas = (frameFile: string, img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement => {
    if (!previewChromaKey) return img;
    
    const cacheKey = `${frameFile}_${rev}`;
    if (keyedCacheRef.current[cacheKey]) {
      return keyedCacheRef.current[cacheKey];
    }

    // Create offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return img;

    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;

    // Detect target background color from top-left pixel (to handle color drift across frames)
    let rTarget = chromaKeyColor ? chromaKeyColor[0] : 0;
    let gTarget = chromaKeyColor ? chromaKeyColor[1] : 0;
    let bTarget = chromaKeyColor ? chromaKeyColor[2] : 0;

    if (data[3] > 0) {
      rTarget = data[0];
      gTarget = data[1];
      bTarget = data[2];
    }
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a === 0) continue;

      // Calculate absolute difference per channel
      const dr = Math.abs(r - rTarget);
      const dg = Math.abs(g - gTarget);
      const db = Math.abs(b - bTarget);
      const maxDiff = Math.max(dr, dg, db);

      if (maxDiff < chromaKeyTolerance) {
        data[i + 3] = 0; // Transparent
      } else if (maxDiff < chromaKeyTolerance + 8) {
        // Soft blending edge (8 pixels transition width, matches python backend)
        const factor = (maxDiff - chromaKeyTolerance) / 8;
        data[i + 3] = Math.round(a * factor);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    keyedCacheRef.current[cacheKey] = offscreen;
    return offscreen;
  };
  
  const currentOffset = offsets.find(o => o.frameIndex === currentFrameIndex) || { frameIndex: currentFrameIndex, dx: 0, dy: 0 };

  // Load images when frames change
  useEffect(() => {
    if (frames.length === 0) return;
    
    const newCache: typeof loadedImages = {};
    let loadedCount = 0;
    
    frames.forEach((frameFile) => {
      const img = new Image();
      // Ensure cross-origin is handled if API is on another port
      img.crossOrigin = "anonymous";
      
      let src = '';
      if (framesDir) {
        if (framesDir.startsWith('projects/')) {
          src = `http://localhost:8000/${framesDir}/${frameFile}?t=${Date.now()}`;
        } else {
          const cleanPath = framesDir.replace('ProcessedSprites/frames/', '');
          src = `http://localhost:8000/frames/${cleanPath}/${frameFile}?t=${Date.now()}`;
        }
      } else {
        src = `http://localhost:8000/frames/${spriteId}/${frameFile}?t=${Date.now()}`;
      }
      
      img.src = src;
      img.onload = () => {
        newCache[frameFile] = img;
        loadedCount++;
        if (loadedCount === frames.length) {
          setLoadedImages(newCache);
        }
      };
    });
  }, [frames, spriteId, framesDir]);

  // Redraw canvas whenever frame, offsets, loaded images, zoom, onion skins, or chroma key configurations change
  useEffect(() => {
    drawCanvas();
  }, [
    currentFrameIndex, 
    loadedImages, 
    scale, 
    pan, 
    offsets, 
    onionSkinPrev, 
    onionSkinNext, 
    onionSkinOpacity, 
    activeTool, 
    selection,
    previewChromaKey,
    chromaKeyColor,
    chromaKeyTolerance,
    rev
  ]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear main canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Onion Skins first (in background)
    ctx.save();
    
    // Previous Frame
    if (onionSkinPrev && currentFrameIndex > 0) {
      const prevFrameFile = frames[currentFrameIndex - 1];
      const prevImg = loadedImages[prevFrameFile];
      if (prevImg) {
        const prevOffset = offsets.find(o => o.frameIndex === currentFrameIndex - 1) || { dx: 0, dy: 0 };
        ctx.globalAlpha = onionSkinOpacity;
        // Apply offset relative to current pan and zoom
        ctx.drawImage(
          getKeyedCanvas(prevFrameFile, prevImg), 
          pan.x + (prevOffset.dx * scale), 
          pan.y + (prevOffset.dy * scale), 
          prevImg.width * scale, 
          prevImg.height * scale
        );
      }
    }

    // Next Frame
    if (onionSkinNext && currentFrameIndex < frames.length - 1) {
      const nextFrameFile = frames[currentFrameIndex + 1];
      const nextImg = loadedImages[nextFrameFile];
      if (nextImg) {
        const nextOffset = offsets.find(o => o.frameIndex === currentFrameIndex + 1) || { dx: 0, dy: 0 };
        ctx.globalAlpha = onionSkinOpacity;
        ctx.drawImage(
          getKeyedCanvas(nextFrameFile, nextImg), 
          pan.x + (nextOffset.dx * scale), 
          pan.y + (nextOffset.dy * scale), 
          nextImg.width * scale, 
          nextImg.height * scale
        );
      }
    }
    ctx.restore();

    // Draw Current Active Frame
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (currentImg) {
      ctx.save();
      // Apply offset relative to current pan and zoom
      ctx.drawImage(
        getKeyedCanvas(currentFrameFile, currentImg), 
        pan.x + (currentOffset.dx * scale), 
        pan.y + (currentOffset.dy * scale), 
        currentImg.width * scale, 
        currentImg.height * scale
      );
      
      // Draw border box indicating current offset frame boundary
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        pan.x + (currentOffset.dx * scale), 
        pan.y + (currentOffset.dy * scale), 
        currentImg.width * scale, 
        currentImg.height * scale
      );
      ctx.restore();
    }

    // Draw Selection Bounding Box if exists
    if (selection && activeTool === 'select') {
      ctx.save();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        pan.x + ((currentOffset.dx + selection.x) * scale),
        pan.y + ((currentOffset.dy + selection.y) * scale),
        selection.w * scale,
        selection.h * scale
      );
      ctx.restore();
    }
  };

  // Convert client coordinates to sprite-local coordinates
  const getLocalCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    // Canvas pixel scale coords (corrected for CSS scaling of the canvas element itself)
    const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (clientY - rect.top) * (canvas.height / rect.height);
    
    // Coordinates relative to the current image's translated bounds
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return null;
    
    // Bounds of the image on canvas:
    const imgX = pan.x + (currentOffset.dx * scale);
    const imgY = pan.y + (currentOffset.dy * scale);
    
    const localX = Math.round((canvasX - imgX) / scale);
    const localY = Math.round((canvasY - imgY) / scale);
    
    return { 
      x: localX, 
      y: localY, 
      imgW: currentImg.width, 
      imgH: currentImg.height,
      canvasX,
      canvasY
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'pan' || e.button === 1 || e.button === 2) {
      // Pan mode
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    if (activeTool === 'brush' || activeTool === 'eraser') {
      setIsDrawing(true);
      drawOnFrame(coords.x, coords.y, activeTool === 'eraser');
    } else if (activeTool === 'select') {
      setIsSelecting(true);
      setSelectStart({ x: coords.x, y: coords.y });
      setSelection({ x: coords.x, y: coords.y, w: 0, h: 0 });
    } else if (activeTool === 'wand') {
      applyMagicWand(coords.x, coords.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    if (isDrawing && (activeTool === 'brush' || activeTool === 'eraser')) {
      drawOnFrame(coords.x, coords.y, activeTool === 'eraser');
    } else if (isSelecting && activeTool === 'select') {
      const w = coords.x - selectStart.x;
      const h = coords.y - selectStart.y;
      setSelection({
        x: w < 0 ? coords.x : selectStart.x,
        y: h < 0 ? coords.y : selectStart.y,
        w: Math.abs(w),
        h: Math.abs(h),
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDrawing(false);
    setIsSelecting(false);
  };

  // Modify frame pixels directly and trigger frame update callback
  const drawOnFrame = (x: number, y: number, erase = false) => {
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return;

    // We draw using an offscreen canvas to edit the original source image size
    const offscreen = document.createElement('canvas');
    offscreen.width = currentImg.width;
    offscreen.height = currentImg.height;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return;

    // Draw existing frame
    oCtx.drawImage(currentImg, 0, 0);

    // Edit pixels
    oCtx.save();
    if (erase) {
      oCtx.globalCompositeOperation = 'destination-out';
      oCtx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      oCtx.fillStyle = brushColor;
    }
    
    // Draw brush dot/stroke
    oCtx.beginPath();
    oCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    oCtx.fill();
    oCtx.restore();

    // Trigger update
    const updatedDataUrl = offscreen.toDataURL('image/png');
    onFrameUpdate(currentFrameIndex, updatedDataUrl);
    setRev(prev => prev + 1);
    
    // Update local image cache immediately to feel responsive
    const updatedImg = new Image();
    updatedImg.src = updatedDataUrl;
    updatedImg.onload = () => {
      setLoadedImages(prev => ({
        ...prev,
        [currentFrameFile]: updatedImg
      }));
    };
  };

  // Magic Wand background keyer (flood fill)
  const applyMagicWand = (startX: number, startY: number) => {
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return;

    if (startX < 0 || startX >= currentImg.width || startY < 0 || startY >= currentImg.height) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = currentImg.width;
    offscreen.height = currentImg.height;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return;

    oCtx.drawImage(currentImg, 0, 0);
    const imgData = oCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;
    const width = imgData.width;
    const height = imgData.height;

    // Get color of start pixel
    const startIdx = (startY * width + startX) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx + 1];
    const targetB = data[startIdx + 2];
    const targetA = data[startIdx + 3];

    // If already transparent, return
    if (targetA === 0) return;

    // Queue for flood fill
    const queue: [number, number][] = [[startX, startY]];
    const visited = new Uint8Array(width * height);
    visited[startY * width + startX] = 1;

    const colorMatch = (r: number, g: number, b: number, a: number) => {
      const dr = Math.abs(r - targetR);
      const dg = Math.abs(g - targetG);
      const db = Math.abs(b - targetB);
      const da = Math.abs(a - targetA);
      return Math.max(dr, dg, db, da) <= wandTolerance;
    };

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const idx = (cy * width + cx) * 4;

      // Key out this pixel (transparent)
      data[idx + 3] = 0;

      // Check 4-way neighbors
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            const pxIdx = nIdx * 4;
            if (colorMatch(data[pxIdx], data[pxIdx + 1], data[pxIdx + 2], data[pxIdx + 3])) {
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    oCtx.putImageData(imgData, 0, 0);
    const updatedDataUrl = offscreen.toDataURL('image/png');
    onFrameUpdate(currentFrameIndex, updatedDataUrl);
    setRev(prev => prev + 1);
    
    // Update local image cache immediately
    const updatedImg = new Image();
    updatedImg.src = updatedDataUrl;
    updatedImg.onload = () => {
      setLoadedImages(prev => ({
        ...prev,
        [currentFrameFile]: updatedImg
      }));
    };
  };

  const handleCopy = () => {
    if (!selection) return;
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = currentImg.width;
    offscreen.height = currentImg.height;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return;

    oCtx.drawImage(currentImg, 0, 0);
    const data = oCtx.getImageData(selection.x, selection.y, selection.w, selection.h);
    setCopiedBuffer(data);
    console.log("Selection copied to buffer.");
  };

  const handlePaste = () => {
    if (!copiedBuffer || !selection) return;
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = currentImg.width;
    offscreen.height = currentImg.height;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return;

    oCtx.drawImage(currentImg, 0, 0);
    // Paste at current selection coordinates
    oCtx.putImageData(copiedBuffer, selection.x, selection.y);

    const updatedDataUrl = offscreen.toDataURL('image/png');
    onFrameUpdate(currentFrameIndex, updatedDataUrl);
    setRev(prev => prev + 1);

    // Update local image cache
    const updatedImg = new Image();
    updatedImg.src = updatedDataUrl;
    updatedImg.onload = () => {
      setLoadedImages(prev => ({
        ...prev,
        [currentFrameFile]: updatedImg
      }));
    };
    console.log("Buffer pasted at selection.");
  };

  const handleZoom = (direction: 'in' | 'out' | 'fit') => {
    if (direction === 'in') {
      setScale(prev => Math.min(prev + 0.25, 4));
    } else if (direction === 'out') {
      setScale(prev => Math.max(prev - 0.25, 0.5));
    } else {
      setScale(1.5);
      setPan({ x: 0, y: 0 });
    }
  };

  const handleNudge = (dir: 'up' | 'down' | 'left' | 'right') => {
    const step = 1;
    let newDx = currentOffset.dx;
    let newDy = currentOffset.dy;
    
    if (dir === 'left') newDx -= step;
    if (dir === 'right') newDx += step;
    if (dir === 'up') newDy -= step;
    if (dir === 'down') newDy += step;
    
    onOffsetChange(currentFrameIndex, newDx, newDy);
  };

  // Keyboard nudge handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only capture arrow keys if not focusing an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }
      
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') handleNudge('left');
        if (e.key === 'ArrowRight') handleNudge('right');
        if (e.key === 'ArrowUp') handleNudge('up');
        if (e.key === 'ArrowDown') handleNudge('down');
      }
      
      // Copy Paste keybinds
      if (e.ctrlKey && e.key === 'c') {
        handleCopy();
      }
      if (e.ctrlKey && e.key === 'v') {
        handlePaste();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrameIndex, selection, offsets, loadedImages, copiedBuffer]);

  return (
    <div ref={containerRef} className="canvas-container flex-col relative w-full h-full bg-[#04060b]">
      {/* Workspace Toolbar overlay */}
      <div className="absolute top-4 left-4 z-10 flex gap-2 glass-panel p-2">
        <button 
          onClick={() => handleZoom('in')} 
          className="btn-icon tooltip" 
          data-tooltip="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button 
          onClick={() => handleZoom('out')} 
          className="btn-icon tooltip" 
          data-tooltip="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button 
          onClick={() => handleZoom('fit')} 
          className="btn-icon tooltip" 
          data-tooltip="Recenter"
        >
          <Maximize size={16} />
        </button>
        
        <div className="w-[1px] bg-white/10 mx-1"></div>
        
        {/* Nudge coordinates display */}
        <div className="flex items-center gap-2 px-3 text-xs font-mono text-indigo-300">
          <span>dx: {currentOffset.dx}px</span>
          <span>dy: {currentOffset.dy}px</span>
        </div>
      </div>

      {/* Frame canvas */}
      <div className="flex-1 w-full h-full flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          width={832}
          height={480}
          className="canvas-checkered-bg cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {/* Copy / Paste controls overlay when selection is active */}
      {selection && activeTool === 'select' && (
        <div className="absolute bottom-4 left-4 z-10 flex gap-2 glass-panel p-2">
          <button onClick={handleCopy} className="text-xs btn-primary">Copy (Ctrl+C)</button>
          <button onClick={handlePaste} className="text-xs btn-success" disabled={!copiedBuffer}>Paste (Ctrl+V)</button>
          <button onClick={() => setSelection(null)} className="text-xs btn-danger">Cancel</button>
        </div>
      )}

      {/* Navigation and key instructions */}
      <div className="absolute bottom-4 right-4 z-10 glass-panel px-3 py-2 text-[11px] text-white/50 flex gap-4">
        <span><kbd className="bg-white/10 px-1 rounded">Arrow Keys</kbd> Nudge Frame Offset</span>
        <span><kbd className="bg-white/10 px-1 rounded">Ctrl + C/V</kbd> Copy/Paste selection</span>
      </div>
    </div>
  );
};

interface Dict<T> {
  [key: string]: T;
}
