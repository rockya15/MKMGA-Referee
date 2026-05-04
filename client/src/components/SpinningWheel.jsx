import { useEffect, useRef, useState, useCallback } from 'react';

// Default duration of the spin animation in ms
const DEFAULT_SPIN_DURATION_MS = 6000;
// Full rotations to add for realism
const FULL_ROTATIONS = 8;

function getSegmentColors(count) {
  const palette = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
    '#00bcd4', '#8bc34a', '#ff5722', '#607d8b',
    '#795548'
  ];
  return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * SpinningWheel
 *
 * Props:
 *   segments        — array of { id, label } for each remaining player on the wheel
 *   targetIndex     — index in `segments` to land on (the pre-determined winner)
 *   spinning        — boolean; set true to trigger a spin animation
 *   onSpinComplete  — callback fired when animation ends
 *   size            — canvas size in px (default 500)
 *   highlightIndex  — when set (not null), dims all segments except this index
 *   dimAmount       — 0–1, how much to dim non-highlighted segments (default 0.25)
 */
export default function SpinningWheel({ segments, targetIndex, spinning, onSpinComplete, size = 500, highlightIndex = null, dimAmount = 0.25, segmentColors = null, spinDurationMs = DEFAULT_SPIN_DURATION_MS }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const startAngleRef = useRef(0);
  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const segmentImageCacheRef = useRef(new Map());
  // Keep a stable ref to onSpinComplete so the animate loop always calls the latest
  // version without needing it in useEffect deps (prevents restarting animation on
  // every render when the callback is an inline function).
  const onSpinCompleteRef = useRef(onSpinComplete);
  useEffect(() => { onSpinCompleteRef.current = onSpinComplete; }, [onSpinComplete]);

  const center = size / 2;
  const radius = center - 10;

  const colors = segmentColors ?? getSegmentColors(segments.length);
  const effectiveSpinDurationMs = Math.max(80, Number(spinDurationMs) || DEFAULT_SPIN_DURATION_MS);

  const drawWheel = useCallback((currentAngle) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const n = segments.length;
    if (n === 0) return;

    ctx.clearRect(0, 0, size, size);

    const sliceAngle = (2 * Math.PI) / n;

    segments.forEach((seg, i) => {
      const start = currentAngle + i * sliceAngle;
      const end = start + sliceAngle;
      const isDimmed = highlightIndex !== null && i !== highlightIndex;

      // Slice
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = isDimmed ? dimAmount : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const labelAngle = start + sliceAngle / 2;
      const labelRadius = radius * 0.65;
      const x = center + labelRadius * Math.cos(labelAngle);
      const y = center + labelRadius * Math.sin(labelAngle);
      const hasImage = !!seg.imageUrl;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(labelAngle + Math.PI / 2);
      ctx.globalAlpha = isDimmed ? dimAmount : 1;
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, Math.min(18, Math.floor(radius / n * 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (hasImage) {
        const cache = segmentImageCacheRef.current;
        const cached = cache.get(seg.imageUrl);
        const imgSize = Math.max(16, Math.min(28, Math.floor(radius / n * 1.7)));
        const imageY = -Math.max(10, Math.floor(imgSize * 0.5));

        if (cached?.loaded && cached.image) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, imageY, imgSize / 2, 0, 2 * Math.PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(cached.image, -imgSize / 2, imageY - imgSize / 2, imgSize, imgSize);
          ctx.restore();

          ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, imageY, imgSize / 2, 0, 2 * Math.PI);
          ctx.closePath();
          ctx.stroke();
        } else if (!cached) {
          const image = new Image();
          cache.set(seg.imageUrl, { image, loaded: false, failed: false });
          image.onload = () => {
            const entry = cache.get(seg.imageUrl);
            if (entry) entry.loaded = true;
            const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
            raf(() => drawWheel(currentAngleRef.current));
          };
          image.onerror = () => {
            const entry = cache.get(seg.imageUrl);
            if (entry) entry.failed = true;
          };
          image.src = seg.imageUrl;
        }
      }

      // Truncate long names
      const maxChars = n <= 4 ? 14 : n <= 8 ? 10 : 7;
      const label = seg.label.length > maxChars ? seg.label.slice(0, maxChars - 1) + '…' : seg.label;
      ctx.fillText(label, 0, hasImage ? 14 : 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    });

    currentAngleRef.current = currentAngle;

    // Center circle
    ctx.beginPath();
    ctx.arc(center, center, 18, 0, 2 * Math.PI);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pointer (top)
    ctx.beginPath();
    ctx.moveTo(center, 8);
    ctx.lineTo(center - 12, 30);
    ctx.lineTo(center + 12, 30);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [segments, colors, center, radius, size]);

  // Compute target angle so that targetIndex segment sits under the pointer (top = -PI/2)
  const computeTargetAngle = useCallback(() => {
    const n = segments.length;
    if (n === 0) return 0;
    const sliceAngle = (2 * Math.PI) / n;
    // The pointer is at -PI/2 (top). We want the center of targetIndex's slice to land there.
    // Slice i starts at: baseAngle + i * sliceAngle, center at: baseAngle + i*sliceAngle + sliceAngle/2
    // We want: baseAngle + targetIndex*sliceAngle + sliceAngle/2 = -PI/2 (mod 2PI)
    // => baseAngle = -PI/2 - targetIndex*sliceAngle - sliceAngle/2
    const targetCenter = -Math.PI / 2 - targetIndex * sliceAngle - sliceAngle / 2;
    
    // Add random jitter within ±1/3 of the segment width for suspense
    // This makes it land randomly within the target segment
    const jitter = (Math.random() - 0.5) * (sliceAngle / 1.5);
    const target = targetCenter + jitter - FULL_ROTATIONS * 2 * Math.PI;
    
    return target;
  }, [segments.length, targetIndex]);

  // Animate
  useEffect(() => {
    if (!spinning) return;

    const finalAngle = computeTargetAngle();
    console.log('[WHEEL] Animation starting. spinning=true, targetIndex=', targetIndex, 'finalAngle=', finalAngle, 'segments=', segments.length);
    startAngleRef.current = startAngleRef.current % (2 * Math.PI); // keep current angle
    // Ensure we always spin forward (add enough rotations)
    let delta = finalAngle - startAngleRef.current;
    // delta should be very negative (spinning forward = CCW in canvas, but visually CW on screen)
    // We actually spin by adding negative angle (canvas CW = negative direction... let's just use absolute target)
    targetAngleRef.current = finalAngle;
    startTimeRef.current = null;

    const animate = (timestamp) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const t = Math.min(elapsed / effectiveSpinDurationMs, 1);
      const eased = easeOut(t);

      const current = startAngleRef.current + (targetAngleRef.current - startAngleRef.current) * eased;
      drawWheel(current);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        startAngleRef.current = targetAngleRef.current;
        drawWheel(targetAngleRef.current);
        if (onSpinCompleteRef.current) onSpinCompleteRef.current();
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [spinning, computeTargetAngle, drawWheel, effectiveSpinDurationMs]);

  // Draw idle state (also re-draws when highlightIndex changes)
  useEffect(() => {
    if (!spinning) {
      drawWheel(startAngleRef.current);
    }
  }, [spinning, drawWheel, segments, highlightIndex, dimAmount]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
}
