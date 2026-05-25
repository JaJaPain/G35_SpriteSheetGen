import React, { useRef, useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Move, Eraser, Wand2, Grid, Scissors } from 'lucide-react';

interface OffsetItem {
  frameIndex: number;
  dx: number;
  dy: number;
  tolerance?: number;
  override_color?: [number, number, number];
}

interface CanvasWorkspaceProps {
  currentFrameIndex: number;
  frames: string[];
  offsets: OffsetItem[];
  spriteId: string;
  framesDir?: string;
  activeTool: 'halo' | 'eraser' | 'wand' | 'select' | 'pan';
  setActiveTool: (tool: 'halo' | 'eraser' | 'wand' | 'select' | 'pan') => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  brushColor: string;
  setBrushColor: (color: string) => void;
  onionSkinPrev: boolean;
  onionSkinNext: boolean;
  onionSkinOpacity: number;
  wandTolerance: number;
  setWandTolerance: (tolerance: number) => void;
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
  setActiveTool,
  brushSize,
  setBrushSize,
  brushColor,
  setBrushColor: _setBrushColor,
  onionSkinPrev,
  onionSkinNext,
  onionSkinOpacity,
  wandTolerance,
  setWandTolerance,
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
  
  // History stack for Undo/Redo
  const [history, setHistory] = useState<Dict<string[]>>({});
  const [historyIndex, setHistoryIndex] = useState<Dict<number>>({});
  
  // Real-time chroma keying cache and revision
  const [rev, setRev] = useState<number>(0);
  const keyedCacheRef = useRef<Dict<HTMLCanvasElement>>({});
  
  // Clear cache when sprite, directory, tolerance, color, or offsets change
  useEffect(() => {
    keyedCacheRef.current = {};
  }, [spriteId, framesDir, chromaKeyColor, chromaKeyTolerance, offsets]);

  const getKeyedCanvas = (frameFile: string, img: HTMLImageElement, frameIndex: number): HTMLCanvasElement | HTMLImageElement => {
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

    // Check if there are overrides for this frame
    const frameOverride = offsets.find(o => o.frameIndex === frameIndex);
    const customColor = frameOverride?.override_color; // [R, G, B] or undefined
    const customTolerance = frameOverride?.tolerance; // number or undefined

    // Detect target background color from top-left pixel (to handle color drift across frames)
    let rTarget = customColor ? customColor[0] : (chromaKeyColor ? chromaKeyColor[0] : 0);
    let gTarget = customColor ? customColor[1] : (chromaKeyColor ? chromaKeyColor[1] : 0);
    let bTarget = customColor ? customColor[2] : (chromaKeyColor ? chromaKeyColor[2] : 0);

    if (!customColor && data[3] > 0) {
      rTarget = data[0];
      gTarget = data[1];
      bTarget = data[2];
    }

    // Calculate local background variance in the top 15 rows of the frame
    // (captures horizontal color gradient and noise across the entire width of the frame)
    const rowsToSample = Math.min(15, img.height);
    let localVariance = 0;

    for (let y = 0; y < rowsToSample; y++) {
      for (let x = 0; x < img.width; x++) {
        const idx = (y * img.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (a === 0) continue;

        const dr = Math.abs(r - rTarget);
        const dg = Math.abs(g - gTarget);
        const db = Math.abs(b - bTarget);
        const diff = Math.max(dr, dg, db);

        if (diff > localVariance) {
          localVariance = diff;
        }
      }
    }

    // Determine base tolerance (frame specific or global)
    const baseTolerance = customTolerance !== undefined ? customTolerance : chromaKeyTolerance;

    // Dynamic adaptive tolerance = base tolerance + local variance
    const adaptiveTolerance = Math.max(5, baseTolerance + localVariance);
    
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

      if (maxDiff < adaptiveTolerance) {
        data[i + 3] = 0; // Transparent
      } else if (maxDiff < adaptiveTolerance + 8) {
        // Soft blending edge (8 pixels transition width, matches python backend)
        const factor = (maxDiff - adaptiveTolerance) / 8;
        data[i + 3] = Math.round(a * factor);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    keyedCacheRef.current[cacheKey] = offscreen;
    return offscreen;
  };
  
  const currentFrameFile = frames[currentFrameIndex] || '';

  const pushHistory = (frameFile: string, dataUrl: string) => {
    setHistory(prev => {
      const stack = prev[frameFile] ? [...prev[frameFile]] : [];
      const currentIdx = historyIndex[frameFile] !== undefined ? historyIndex[frameFile] : -1;
      const newStack = stack.slice(0, currentIdx + 1);
      newStack.push(dataUrl);
      return {
        ...prev,
        [frameFile]: newStack
      };
    });
    setHistoryIndex(prev => {
      const currentIdx = prev[frameFile] !== undefined ? prev[frameFile] : -1;
      return {
        ...prev,
        [frameFile]: currentIdx + 1
      };
    });
  };

  const handleUndo = () => {
    if (!currentFrameFile) return;
    const stack = history[currentFrameFile];
    const currentIdx = historyIndex[currentFrameFile];
    if (!stack || currentIdx === undefined || currentIdx < 0) return;

    const newIdx = currentIdx - 1;
    let targetSrc = '';

    if (newIdx === -1) {
      // Revert to original raw image
      if (framesDir) {
        if (framesDir.startsWith('projects/')) {
          targetSrc = `http://localhost:8000/${framesDir}/${currentFrameFile}`;
        } else {
          const cleanPath = framesDir.replace('ProcessedSprites/frames/', '');
          targetSrc = `http://localhost:8000/frames/${cleanPath}/${currentFrameFile}`;
        }
      } else {
        targetSrc = `http://localhost:8000/frames/${spriteId}/${currentFrameFile}`;
      }
    } else {
      targetSrc = stack[newIdx];
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = targetSrc;
    img.onload = () => {
      setLoadedImages(prev => ({
        ...prev,
        [currentFrameFile]: img
      }));
      setRev(prev => prev + 1);
      onFrameUpdate(currentFrameIndex, targetSrc);
    };

    setHistoryIndex(prev => ({
      ...prev,
      [currentFrameFile]: newIdx
    }));
  };

  const handleRedo = () => {
    if (!currentFrameFile) return;
    const stack = history[currentFrameFile];
    const currentIdx = historyIndex[currentFrameFile];
    if (!stack || currentIdx === undefined || currentIdx >= stack.length - 1) return;

    const newIdx = currentIdx + 1;
    const targetSrc = stack[newIdx];

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = targetSrc;
    img.onload = () => {
      setLoadedImages(prev => ({
        ...prev,
        [currentFrameFile]: img
      }));
      setRev(prev => prev + 1);
      onFrameUpdate(currentFrameIndex, targetSrc);
    };

    setHistoryIndex(prev => ({
      ...prev,
      [currentFrameFile]: newIdx
    }));
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
          getKeyedCanvas(prevFrameFile, prevImg, currentFrameIndex - 1), 
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
          getKeyedCanvas(nextFrameFile, nextImg, currentFrameIndex + 1), 
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
        getKeyedCanvas(currentFrameFile, currentImg, currentFrameIndex), 
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

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      drawOnFrame(coords.x, coords.y, true);
    } else if (activeTool === 'halo') {
      applyHaloRemover();
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

    if (isDrawing && activeTool === 'eraser') {
      drawOnFrame(coords.x, coords.y, true);
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
    pushHistory(currentFrameFile, updatedDataUrl);
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

  // Halo Remover - finds all pixels touching alpha (transparency) and sets them to alpha = 0 (1px erosion)
  const applyHaloRemover = () => {
    const currentFrameFile = frames[currentFrameIndex];
    const currentImg = loadedImages[currentFrameFile];
    if (!currentImg) return;

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

    // Check if there are overrides for this frame to find the exact keying parameters
    const frameOverride = offsets.find(o => o.frameIndex === currentFrameIndex);
    const customColor = frameOverride?.override_color; // [R, G, B] or undefined
    const customTolerance = frameOverride?.tolerance; // number or undefined

    // Detect target background color from top-left pixel (matches getKeyedCanvas)
    let rTarget = customColor ? customColor[0] : (chromaKeyColor ? chromaKeyColor[0] : 0);
    let gTarget = customColor ? customColor[1] : (chromaKeyColor ? chromaKeyColor[1] : 0);
    let bTarget = customColor ? customColor[2] : (chromaKeyColor ? chromaKeyColor[2] : 0);

    if (!customColor && data[3] > 0) {
      rTarget = data[0];
      gTarget = data[1];
      bTarget = data[2];
    }

    // Calculate local background variance in the top 15 rows of the frame
    const rowsToSample = Math.min(15, height);
    let localVariance = 0;
    for (let y = 0; y < rowsToSample; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        if (a === 0) continue;

        const dr = Math.abs(data[idx] - rTarget);
        const dg = Math.abs(data[idx + 1] - gTarget);
        const db = Math.abs(data[idx + 2] - bTarget);
        const diff = Math.max(dr, dg, db);
        if (diff > localVariance) {
          localVariance = diff;
        }
      }
    }

    // Determine base tolerance and dynamic adaptive tolerance
    const baseTolerance = customTolerance !== undefined ? customTolerance : chromaKeyTolerance;
    const adaptiveTolerance = Math.max(5, baseTolerance + localVariance);

    // Helper: is this pixel transparent, either by real alpha or chroma-key matching?
    const isBackgroundPixel = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return true; // Out-of-bounds acts as background border
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (a === 0) return true;

      if (previewChromaKey) {
        const dr = Math.abs(r - rTarget);
        const dg = Math.abs(g - gTarget);
        const db = Math.abs(b - bTarget);
        const maxDiff = Math.max(dr, dg, db);
        // Treat as background if it matches chroma key within tolerance
        return maxDiff < adaptiveTolerance;
      }

      return false;
    };

    // Mask boundary pixels for removal
    const toRemove = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // If this is a character foreground pixel, check if it touches the background
        if (!isBackgroundPixel(x, y)) {
          let touchesAlpha = false;

          // 4-way neighbors
          const neighbors = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1]
          ];

          for (const [nx, ny] of neighbors) {
            if (isBackgroundPixel(nx, ny)) {
              touchesAlpha = true;
              break;
            }
          }

          if (touchesAlpha) {
            toRemove[y * width + x] = 1;
          }
        }
      }
    }

    // Set alpha to 0 for marked boundary pixels (remove 1px edge)
    let pixelsRemovedCount = 0;
    for (let i = 0; i < toRemove.length; i++) {
      if (toRemove[i] === 1) {
        data[i * 4 + 3] = 0;
        pixelsRemovedCount++;
      }
    }

    if (pixelsRemovedCount === 0) {
      console.log("No edge pixels touching alpha found.");
      return;
    }

    oCtx.putImageData(imgData, 0, 0);
    const updatedDataUrl = offscreen.toDataURL('image/png');
    onFrameUpdate(currentFrameIndex, updatedDataUrl);
    pushHistory(currentFrameFile, updatedDataUrl);
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
    console.log(`Halo Remover: Removed ${pixelsRemovedCount} boundary pixels.`);
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
    pushHistory(currentFrameFile, updatedDataUrl);
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
    pushHistory(currentFrameFile, updatedDataUrl);
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
      
      // Undo/Redo keybinds
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrameIndex, selection, offsets, loadedImages, copiedBuffer, history, historyIndex, frames, framesDir, spriteId, currentFrameFile]);

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full bg-[#04060b] overflow-hidden">
      {/* 1. Top Editor Control Bar (Solid header, not floating) */}
      <div className="h-12 bg-[#090d1a] border-b border-white/5 flex items-center justify-between px-4 flex-shrink-0 select-none">
        
        {/* Left Side: Zoom Controls + Undo/Redo */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-black/20 rounded-lg p-0.5 border border-white/5">
            <button 
              onClick={() => handleZoom('in')} 
              className="p-1.5 hover:bg-white/5 rounded text-white/70 hover:text-white transition-all"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button 
              onClick={() => handleZoom('out')} 
              className="p-1.5 hover:bg-white/5 rounded text-white/70 hover:text-white transition-all"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button 
              onClick={() => handleZoom('fit')} 
              className="p-1.5 hover:bg-white/5 rounded text-white/70 hover:text-white transition-all"
              title="Fit Screen"
            >
              <Maximize size={14} />
            </button>
          </div>
          
          <div className="w-[1px] bg-white/10 h-5 mx-1"></div>
          
          <div className="flex items-center bg-black/20 rounded-lg p-0.5 border border-white/5">
            <button 
              onClick={handleUndo} 
              className="p-1.5 hover:bg-white/5 rounded text-white/70 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
              title="Undo (Ctrl+Z)"
              disabled={historyIndex[currentFrameFile] === undefined || historyIndex[currentFrameFile] === -1}
            >
              <Undo2 size={14} />
            </button>
            <button 
              onClick={handleRedo} 
              className="p-1.5 hover:bg-white/5 rounded text-white/70 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
              title="Redo (Ctrl+Y)"
              disabled={!history[currentFrameFile] || historyIndex[currentFrameFile] === undefined || historyIndex[currentFrameFile] >= history[currentFrameFile].length - 1}
            >
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* Center: Contextual Tool Properties Bar */}
        <div className="flex items-center gap-3">
          {activeTool === 'pan' && (
            <span className="text-[11px] text-white/40 italic">Pan mode active. Drag canvas to navigate.</span>
          )}
          
          {activeTool === 'eraser' && (
            <div className="flex items-center gap-4 bg-white/5 px-3 py-1 rounded-lg border border-white/5">
              <span className="text-[11px] text-white/50 uppercase tracking-wider font-semibold font-mono">
                Eraser Settings
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/40 font-mono">Size:</span>
                <input 
                  type="range" 
                  min="1" 
                  max="20" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-20 h-1 bg-black/40 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[11px] font-mono text-indigo-300 font-bold w-4">{brushSize}px</span>
              </div>
            </div>
          )}

          {activeTool === 'halo' && (
            <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 animate-fade-in flex-row">
              <span className="text-[11px] text-indigo-300 uppercase tracking-wider font-semibold font-mono flex items-center gap-1.5">
                <Scissors size={12} /> Halo Remover Active
              </span>
              <span className="text-[10px] text-white/50">Click anywhere on canvas to trim 1px off transparent boundaries.</span>
            </div>
          )}
          
          {activeTool === 'wand' && (
            <div className="flex items-center gap-3 bg-white/5 px-3 py-1 rounded-lg border border-white/5">
              <span className="text-[11px] text-white/50 uppercase tracking-wider font-semibold font-mono">Magic Wand Settings</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/40 font-mono">Tolerance:</span>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value={wandTolerance} 
                  onChange={(e) => setWandTolerance(parseInt(e.target.value))}
                  className="w-24 h-1 bg-black/40 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[11px] font-mono text-indigo-300 font-bold w-6">{wandTolerance}</span>
              </div>
            </div>
          )}

          {activeTool === 'select' && (
            <span className="text-[11px] text-white/40 italic">Drag to select bounding box. Copy with Ctrl+C, paste with Ctrl+V.</span>
          )}
        </div>

        {/* Right Side: Coordinates Display & Offset Nudge info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-indigo-950/20 rounded-lg border border-indigo-900/20 text-xs font-mono text-indigo-300">
            <span>dx: {currentOffset.dx}px</span>
            <span>dy: {currentOffset.dy}px</span>
          </div>
        </div>
      </div>

      {/* 2. Main Row: Side Tools + Viewport Canvas */}
      <div className="flex-1 w-full h-full flex flex-row overflow-hidden relative">
        
        {/* Docked Left Sidebar Tools */}
        <div className="w-14 bg-[#090d1a] border-r border-white/5 flex flex-col items-center py-4 gap-4 flex-shrink-0 select-none">
          <button 
            onClick={() => setActiveTool('pan')} 
            className={`p-2 rounded-lg transition-all hover:bg-white/5 ${activeTool === 'pan' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'text-white/60 hover:text-white'}`}
            title="Pan & Navigation"
          >
            <Move size={18} />
          </button>
          <button 
            onClick={() => setActiveTool('halo')} 
            className={`p-2 rounded-lg transition-all hover:bg-white/5 ${activeTool === 'halo' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'text-white/60 hover:text-white'}`}
            title="Halo Remover (Click Canvas)"
          >
            <Scissors size={18} />
          </button>
          <button 
            onClick={() => setActiveTool('eraser')} 
            className={`p-2 rounded-lg transition-all hover:bg-white/5 ${activeTool === 'eraser' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'text-white/60 hover:text-white'}`}
            title="Eraser Tool"
          >
            <Eraser size={18} />
          </button>
          <button 
            onClick={() => setActiveTool('wand')} 
            className={`p-2 rounded-lg transition-all hover:bg-white/5 ${activeTool === 'wand' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'text-white/60 hover:text-white'}`}
            title="Magic Wand (Keyer)"
          >
            <Wand2 size={18} />
          </button>
          <button 
            onClick={() => setActiveTool('select')} 
            className={`p-2 rounded-lg transition-all hover:bg-white/5 ${activeTool === 'select' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'text-white/60 hover:text-white'}`}
            title="Copy Bounding Box"
          >
            <Grid size={18} />
          </button>
        </div>

        {/* Viewport Canvas Drawing Area */}
        <div className="flex-1 h-full flex items-center justify-center overflow-hidden relative bg-[#04060b]">
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

          {/* Copy / Paste controls overlay when selection is active */}
          {selection && activeTool === 'select' && (
            <div className="absolute bottom-4 left-4 z-10 flex gap-2 glass-panel p-2 animate-fade-in">
              <button onClick={handleCopy} className="text-xs btn-primary py-1 px-3">Copy (Ctrl+C)</button>
              <button onClick={handlePaste} className="text-xs btn-success py-1 px-3" disabled={!copiedBuffer}>Paste (Ctrl+V)</button>
              <button onClick={() => setSelection(null)} className="text-xs btn-danger py-1 px-2">Cancel</button>
            </div>
          )}

          {/* Helper keyboard shortcuts text in bottom-right */}
          <div className="absolute bottom-4 right-4 z-10 glass-panel px-3 py-1.5 text-[10px] text-white/40 flex gap-3 select-none pointer-events-none">
            <span><kbd className="bg-white/10 px-1 rounded text-white/60 mr-1">Arrow Keys</kbd> Nudge Offset</span>
            <span><kbd className="bg-white/10 px-1 rounded text-white/60 mr-1">Ctrl + C / V</kbd> Copy/Paste</span>
            <span><kbd className="bg-white/10 px-1 rounded text-white/60 mr-1">Ctrl + Z / Y</kbd> Undo/Redo</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface Dict<T> {
  [key: string]: T;
}
